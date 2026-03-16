import { execSync } from "child_process";
import type { ClaudeResponse } from "./orchestrator.js";

/** Options for building Claude CLI arguments */
export interface ClaudeExecOptions {
  prompt: string;
  systemPrompt: string;
  allowedTools: string[];
  timeout: number;
  sessionId?: string;
  /** Permission mode for Claude CLI (default: "bypassPermissions") */
  permissionMode?: string;
  /** Maximum budget in USD per call */
  maxBudgetUsd?: number;
  /** Callback for real-time stderr lines from Claude CLI */
  onStderr?: (line: string) => void;
  /** Callback for real-time stream-json events from Claude CLI stdout */
  onStreamEvent?: (event: StreamEvent) => void;
  /** Abort signal to cancel the running Claude process */
  signal?: AbortSignal;
}

/** A parsed stream-json event from Claude CLI */
export interface StreamEvent {
  type: string;
  subtype?: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
  result?: string;
  session_id?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  /** Raw JSON string for custom parsing */
  raw: string;
}

/** Raw output from Claude CLI process */
export interface RawClaudeOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Build the argument array for invoking Claude Code CLI.
 *
 * Maps Forge options to Claude CLI flags:
 * - `-p` for the prompt text
 * - `--output-format json` for structured output
 * - `--append-system-prompt` for agent role instructions
 * - `--allowedTools` for tool sandboxing
 * - `--continue` with session ID for continuity
 */
export function buildClaudeArgs(options: ClaudeExecOptions): string[] {
  const args: string[] = [];

  // Prompt (non-interactive mode)
  args.push("-p", options.prompt);

  // Output format: stream-json for real-time event streaming
  args.push("--output-format", "stream-json");
  args.push("--verbose");

  // Skip permissions so Claude doesn't hang waiting for interactive prompts.
  // This is safe because forge controls which tools are allowed via --allowedTools.
  args.push("--dangerously-skip-permissions");

  // System prompt
  if (options.systemPrompt) {
    args.push("--append-system-prompt", options.systemPrompt);
  }

  // Allowed tools
  if (options.allowedTools.length > 0) {
    args.push("--allowedTools", options.allowedTools.join(","));
  }

  // Session continuity
  if (options.sessionId) {
    args.push("--continue", options.sessionId);
  }

  // Budget cap
  if (options.maxBudgetUsd !== undefined) {
    args.push("--max-budget-usd", String(options.maxBudgetUsd));
  }

  return args;
}

/**
 * Parse raw Claude CLI output into a structured response.
 *
 * Handles multiple output formats:
 * 1. Flat JSON object: `{ result: "...", exitCode: 0 }`
 * 2. CLI array: `[{ type: "system" }, { type: "result", result: "..." }]`
 * 3. Plain text fallback
 *
 * Extracts FORGE_STATUS block for structured metadata.
 */
export function parseClaudeResponse(raw: RawClaudeOutput, streamEvents?: StreamEvent[]): ClaudeResponse {
  // Handle error exit codes
  if (raw.exitCode !== 0) {
    const fallbackMsg = `Process exited with code ${raw.exitCode}`;
    const errorText = raw.stderr || raw.stdout || fallbackMsg;
    // Exit code 143 = SIGTERM (128+15), typically from timeout kill
    // Exit code 124 = timeout wrapper exit code
    const isTimeout = raw.exitCode === 143 || raw.exitCode === 124;
    const timeoutMsg = isTimeout
      ? `Process timed out (exit code ${raw.exitCode}) — consider increasing timeoutMinutes`
      : undefined;
    // Detect context window exhaustion
    const isContextLimit =
      errorText.includes("exceed context limit") ||
      errorText.includes("context_length_exceeded") ||
      errorText.includes("maximum context length");
    // Layer 2 & 3: Rate limit detection from error text
    // Timeout exit codes are NOT rate limits
    const isRateLimited = !isTimeout && detectRateLimitInText(errorText);
    return {
      status: "error",
      exitSignal: false,
      filesModified: [],
      testsPass: false,
      testResults: { total: 0, passed: 0, failed: 0 },
      error: timeoutMsg ?? errorText,
      contextExhausted: isContextLimit,
      rateLimited: isRateLimited,
      rawStderr: raw.stderr || undefined,
      rawStdout: raw.stdout ? raw.stdout.slice(0, 2000) : undefined,
    };
  }

  // Stream-json mode: extract result from stream events
  if (streamEvents && streamEvents.length > 0) {
    return parseStreamEvents(streamEvents, raw);
  }

  // Fallback: try to parse as batch JSON (backwards compat)
  let resultText = "";
  let conversationItems: ConversationItem[] = [];
  try {
    const parsed = JSON.parse(raw.stdout);

    if (Array.isArray(parsed)) {
      conversationItems = parsed as ConversationItem[];
      const resultEntry = conversationItems.find((e) => e.type === "result");
      resultText = (resultEntry?.result as string) ?? "";
    } else if (typeof parsed === "object" && parsed !== null) {
      resultText = (parsed.result as string) ?? "";
    }
  } catch {
    resultText = raw.stdout;
  }

  // Layer 1: Check for rate_limit_event in structured JSON output
  const rateLimitedFromJson = detectRateLimitInItems(conversationItems);
  if (rateLimitedFromJson) {
    return {
      status: "error",
      exitSignal: false,
      filesModified: [],
      testsPass: false,
      testResults: { total: 0, passed: 0, failed: 0 },
      error: "API rate limit reached (rate_limit_event detected)",
      rateLimited: true,
    };
  }

  // Extract file paths from tool_use entries (Write, Edit, Read operations)
  const filesModified = extractFilesFromToolUse(conversationItems);

  // Extract test results from tool_use bash outputs
  const testResults = extractTestResults(conversationItems, resultText);

  // Extract FORGE_STATUS block (fallback for structured metadata)
  const statusBlock = extractStatusBlock(resultText);

  // Determine exit signal
  const exitSignal = statusBlock?.EXIT_SIGNAL === "true";

  // Determine test status from test results or status block
  let testsPass = true;
  if (testResults.total > 0) {
    testsPass = testResults.failed === 0;
  } else if (statusBlock?.TESTS_STATUS) {
    testsPass = statusBlock.TESTS_STATUS === "PASSING";
  }

  return {
    status: "success",
    exitSignal,
    filesModified,
    testsPass,
    testResults,
    error: null,
    resultText: resultText || raw.stdout,
  };
}

/**
 * Parse stream-json events into a ClaudeResponse.
 *
 * Stream events include:
 * - system/init: session info
 * - assistant: text and tool_use blocks
 * - rate_limit_event: API rate limit status
 * - result: final result with cost and duration
 */
function parseStreamEvents(events: StreamEvent[], raw: RawClaudeOutput): ClaudeResponse {
  // Find the result event
  const resultEvent = events.find((e) => e.type === "result");
  const resultText = (resultEvent?.result as string) ?? "";

  // Check for rate limit rejection
  for (const event of events) {
    if (event.type === "rate_limit_event") {
      try {
        const parsed = JSON.parse(event.raw);
        if (parsed.rate_limit_info?.status === "rejected") {
          return {
            status: "error",
            exitSignal: false,
            filesModified: [],
            testsPass: false,
            testResults: { total: 0, passed: 0, failed: 0 },
            error: "API rate limit reached (rate_limit_event rejected)",
            rateLimited: true,
          };
        }
      } catch { /* ignore parse error */ }
    }
  }

  // Convert stream events to ConversationItem format for reuse of existing extractors
  const conversationItems: ConversationItem[] = [];
  for (const event of events) {
    if (event.type === "assistant" && event.message?.content) {
      conversationItems.push({
        type: "assistant",
        content: event.message.content as ConversationContent[],
      });
    }
    if (event.type === "result") {
      conversationItems.push({
        type: "result",
        result: event.result,
      });
    }
  }

  // Extract file paths from tool_use entries
  const filesModified = extractFilesFromToolUse(conversationItems);

  // Extract test results
  const testResults = extractTestResults(conversationItems, resultText);

  // Extract FORGE_STATUS block
  const statusBlock = extractStatusBlock(resultText);
  const exitSignal = statusBlock?.EXIT_SIGNAL === "true";

  let testsPass = true;
  if (testResults.total > 0) {
    testsPass = testResults.failed === 0;
  } else if (statusBlock?.TESTS_STATUS) {
    testsPass = statusBlock.TESTS_STATUS === "PASSING";
  }

  // Detect context exhaustion from result event
  let isError = false;
  if (resultEvent) {
    try {
      const parsed = JSON.parse(resultEvent.raw);
      isError = parsed.is_error === true;
    } catch { /* ignore */ }
  }

  return {
    status: isError ? "error" : "success",
    exitSignal,
    filesModified,
    testsPass,
    testResults,
    error: isError ? (resultText || "Claude execution error") : null,
    resultText: resultText || raw.stdout,
    rawStderr: raw.stderr || undefined,
    sessionId: resultEvent?.session_id ?? events.find((e) => e.session_id)?.session_id,
  };
}

/** Conversation item from Claude Code JSON output */
interface ConversationItem {
  type: string;
  tool?: string;
  content?: string | ConversationContent[];
  result?: string;
}

interface ConversationContent {
  type: string;
  tool_use_id?: string;
  name?: string;
  input?: Record<string, unknown>;
  text?: string;
  content?: string;
}

/**
 * Extract real file paths from Claude Code tool_use entries.
 *
 * Looks for Write, Edit, and NotebookEdit tool calls which contain
 * file_path in their input. Returns unique paths.
 */
function extractFilesFromToolUse(items: ConversationItem[]): string[] {
  const files = new Set<string>();

  for (const item of items) {
    // Handle items with content array (assistant messages with tool_use)
    if (Array.isArray(item.content)) {
      for (const block of item.content) {
        if (block.type === "tool_use" && block.input) {
          const filePath = block.input.file_path as string | undefined;
          if (filePath) {
            files.add(filePath);
          }
        }
      }
    }

    // Handle tool_result items that reference file operations
    if (item.type === "tool_result" && typeof item.content === "string") {
      const fileMatch = item.content.match(/(?:wrote|edited|created)\s+(.+)/i);
      if (fileMatch?.[1]) {
        files.add(fileMatch[1].trim());
      }
    }
  }

  return [...files];
}

/**
 * Extract test results from bash tool outputs.
 *
 * Looks for common test runner output patterns:
 * - Vitest: "Tests  X passed (X)" or "X passed | X failed"
 * - Jest: "Tests: X passed, X failed, X total"
 * - pytest: "X passed, X failed"
 * - Generic: "X passing", "X failing"
 */
function extractTestResults(
  items: ConversationItem[],
  resultText: string
): { total: number; passed: number; failed: number } {
  // Collect all text content from tool results and result text
  const allText = [resultText];
  for (const item of items) {
    if (typeof item.content === "string") {
      allText.push(item.content);
    }
    if (item.result) {
      allText.push(item.result);
    }
  }

  const combined = allText.join("\n");

  // Vitest/Jest pattern: "Tests  42 passed (42)" or "Tests: 5 passed, 2 failed, 7 total"
  const vitestMatch = combined.match(/Tests\s+(\d+)\s+passed\s+\((\d+)\)/);
  if (vitestMatch) {
    const passed = parseInt(vitestMatch[1]!, 10);
    const total = parseInt(vitestMatch[2]!, 10);
    return { total, passed, failed: total - passed };
  }

  const jestMatch = combined.match(/Tests:\s*(\d+)\s+passed,?\s*(\d+)\s+failed,?\s*(\d+)\s+total/);
  if (jestMatch) {
    return {
      passed: parseInt(jestMatch[1]!, 10),
      failed: parseInt(jestMatch[2]!, 10),
      total: parseInt(jestMatch[3]!, 10),
    };
  }

  // pytest pattern: "5 passed, 2 failed"
  const pytestMatch = combined.match(/(\d+)\s+passed(?:,\s*(\d+)\s+failed)?/);
  if (pytestMatch) {
    const passed = parseInt(pytestMatch[1]!, 10);
    const failed = pytestMatch[2] ? parseInt(pytestMatch[2], 10) : 0;
    return { total: passed + failed, passed, failed };
  }

  // FORGE_STATUS fallback
  const statusBlock = extractStatusBlock(resultText);
  if (statusBlock?.TESTS_TOTAL) {
    return {
      total: parseInt(statusBlock.TESTS_TOTAL, 10),
      passed: parseInt(statusBlock.TESTS_PASSED ?? "0", 10),
      failed: parseInt(statusBlock.TESTS_FAILED ?? "0", 10),
    };
  }

  return { total: 0, passed: 0, failed: 0 };
}

/** Extract key-value pairs from FORGE_STATUS block */
function extractStatusBlock(
  text: string
): Record<string, string> | null {
  const match = text.match(
    /---FORGE_STATUS---\s*([\s\S]*?)\s*---END_FORGE_STATUS---/
  );
  if (!match?.[1]) return null;

  const block: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kvMatch = line.match(/^\s*([A-Z_]+)\s*:\s*(.+?)\s*$/);
    if (kvMatch?.[1] && kvMatch[2]) {
      block[kvMatch[1]] = kvMatch[2];
    }
  }
  return block;
}

/**
 * Detect API rate limit indicators in text output.
 * Layer 2: Pattern matching on error messages.
 */
function detectRateLimitInText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("5 hour limit") ||
    lower.includes("usage limit reached") ||
    lower.includes("rate limit") ||
    /limit reached.*try back/i.test(text)
  );
}

/**
 * Detect rate_limit_event in Claude CLI structured JSON output.
 * Layer 1: Structural detection from conversation items.
 */
function detectRateLimitInItems(items: ConversationItem[]): boolean {
  for (const item of items) {
    // Check for rate_limit_event type
    if (item.type === "rate_limit_event") return true;

    // Check content for rate limit indicators
    const contentStr =
      typeof item.content === "string"
        ? item.content
        : Array.isArray(item.content)
          ? JSON.stringify(item.content)
          : "";
    if (
      contentStr.includes("rate_limit_event") &&
      contentStr.includes('"rejected"')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Detect files changed in the working tree using git status.
 *
 * Returns paths of modified, added, and untracked files relative to projectRoot.
 * Used after each Claude execution to detect what files the agent touched,
 * since `--output-format json` only returns the result text, not tool_use entries.
 */
export function detectChangedFiles(projectRoot: string): string[] {
  try {
    // -u shows individual files in untracked directories (not just dir names)
    const output = execSync("git status --porcelain -u", {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => line.slice(3).trim())
      .filter((f) => f.length > 0);
  } catch {
    return [];
  }
}

/**
 * Get the current HEAD commit SHA.
 *
 * Used to snapshot before/after an execution to detect commits
 * made by Claude during the run.
 */
export function getHeadSha(projectRoot: string): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Detect files changed between two commits using git diff.
 *
 * Returns file paths that were modified, added, or deleted in commits
 * between `fromSha` and HEAD. This catches files that were already
 * committed by Claude during execution (which `git status` would miss).
 */
export function detectFilesFromCommits(
  projectRoot: string,
  fromSha: string
): string[] {
  try {
    const output = execSync(`git diff --name-only ${fromSha}..HEAD`, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output
      .split("\n")
      .filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * Count commits between two SHAs.
 */
export function countCommitsBetween(
  projectRoot: string,
  fromSha: string
): number {
  try {
    const output = execSync(`git rev-list --count ${fromSha}..HEAD`, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return parseInt(output.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Claude Code executor that spawns the CLI process.
 *
 * Uses `child_process.spawn` to run `claude` with constructed arguments.
 * Captures stdout/stderr and parses the response.
 *
 * After each execution, detects changed files via `git status` since
 * Claude CLI's `--output-format json` returns only the result text,
 * not the full conversation with tool_use entries.
 */
export class ClaudeCodeExecutor {
  private claudeCmd: string;
  private verbose: boolean;
  private projectRoot: string;

  constructor(claudeCmd: string = "claude", verbose: boolean = false, projectRoot?: string) {
    this.claudeCmd = claudeCmd;
    this.verbose = verbose;
    this.projectRoot = projectRoot ?? process.cwd();
  }

  async execute(options: ClaudeExecOptions): Promise<ClaudeResponse> {
    const args = buildClaudeArgs(options);

    if (this.verbose) {
      const promptPreview = options.prompt.slice(0, 80).replace(/\n/g, " ");
      const totalArgLen = args.reduce((s, a) => s + a.length, 0);
      process.stderr.write(`[forge] Executing: ${this.claudeCmd} (${args.length} args, ${totalArgLen} chars total)\n`);
      process.stderr.write(`[forge] Prompt (${options.prompt.length} chars): ${promptPreview}...\n`);
      process.stderr.write(`[forge] Tools: ${options.allowedTools.join(", ")}\n`);
      process.stderr.write(`[forge] stdin=ignore, CLAUDECODE stripped\n`);
    }

    // Snapshot changed files and HEAD commit before execution to diff later
    const filesBefore = new Set(detectChangedFiles(this.projectRoot));
    const headBefore = getHeadSha(this.projectRoot);

    const { spawn } = await import("child_process");

    return new Promise((resolve) => {
      // Strip CLAUDECODE env var to prevent "cannot run inside another Claude" error
      const env = { ...process.env };
      delete env.CLAUDECODE;

      const proc = spawn(this.claudeCmd, args, {
        timeout: options.timeout,
        stdio: ["ignore", "pipe", "pipe"],
        env,
        cwd: this.projectRoot,
        detached: true,
      });

      // Kill child process on abort signal
      if (options.signal) {
        const killProc = () => {
          // Kill process group if possible, fall back to SIGKILL
          try {
            if (proc.pid) process.kill(-proc.pid, "SIGTERM");
          } catch {
            proc.kill("SIGKILL");
          }
        };
        if (options.signal.aborted) {
          killProc();
        } else {
          options.signal.addEventListener("abort", killProc, { once: true });
          proc.on("close", () => options.signal?.removeEventListener("abort", killProc));
        }
      }

      let stdout = "";
      let stderr = "";
      let stdoutBuffer = ""; // Buffer for incomplete JSON lines
      const streamEvents: StreamEvent[] = [];

      proc.stdout?.on("data", (data: Buffer) => {
        const text = data.toString();
        stdout += text;

        // Parse stream-json: each line is a complete JSON event
        stdoutBuffer += text;
        const lines = stdoutBuffer.split("\n");
        // Keep the last (possibly incomplete) chunk in the buffer
        stdoutBuffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed) as StreamEvent;
            event.raw = trimmed;
            streamEvents.push(event);
            if (options.onStreamEvent) {
              options.onStreamEvent(event);
            }
          } catch {
            // Not JSON — still feed to onStderr for raw logging
            if (options.onStderr && trimmed) {
              options.onStderr(trimmed);
            }
          }
        }
      });

      proc.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        if (this.verbose) {
          process.stderr.write(`[forge:stderr] ${text}`);
        }
        if (options.onStderr) {
          for (const line of text.split("\n")) {
            if (line.trim()) options.onStderr(line);
          }
        }
      });

      proc.on("close", (code) => {
        // Flush any remaining buffer
        if (stdoutBuffer.trim()) {
          try {
            const event = JSON.parse(stdoutBuffer.trim()) as StreamEvent;
            event.raw = stdoutBuffer.trim();
            streamEvents.push(event);
          } catch { /* ignore */ }
        }

        if (this.verbose) {
          process.stderr.write(`[forge] Process exited with code ${code}, stdout ${stdout.length} bytes, ${streamEvents.length} events\n`);
        }
        const raw: RawClaudeOutput = {
          stdout,
          stderr,
          exitCode: code ?? 1,
        };
        const response = parseClaudeResponse(raw, streamEvents);

        // Detect files changed by this execution via git
        if (response.status === "success" && response.filesModified.length === 0) {
          // First check uncommitted changes (git status)
          const filesAfter = detectChangedFiles(this.projectRoot);
          const newFiles = filesAfter.filter((f) => !filesBefore.has(f));
          if (newFiles.length > 0) {
            response.filesModified = newFiles;
            if (this.verbose) {
              process.stderr.write(`[forge] Detected ${newFiles.length} changed files via git status: ${newFiles.join(", ")}\n`);
            }
          }

          // Also check files changed in commits made during execution
          // (Claude may have committed files, making them invisible to git status)
          if (response.filesModified.length === 0 && headBefore) {
            const committedFiles = detectFilesFromCommits(this.projectRoot, headBefore);
            if (committedFiles.length > 0) {
              response.filesModified = committedFiles;
              if (this.verbose) {
                process.stderr.write(`[forge] Detected ${committedFiles.length} files from new commits: ${committedFiles.join(", ")}\n`);
              }
            }
          }
        }

        resolve(response);
      });

      proc.on("error", (err) => {
        if (this.verbose) {
          process.stderr.write(`[forge] Process error: ${err.message}\n`);
        }
        resolve({
          status: "error",
          exitSignal: false,
          filesModified: [],
          testsPass: false,
          testResults: { total: 0, passed: 0, failed: 0 },
          error: err.message,
        });
      });
    });
  }
}
