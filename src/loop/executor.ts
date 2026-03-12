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

  // Output format
  args.push("--output-format", "json");

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
export function parseClaudeResponse(raw: RawClaudeOutput): ClaudeResponse {
  // Handle error exit codes
  if (raw.exitCode !== 0) {
    return {
      status: "error",
      exitSignal: false,
      filesModified: [],
      testsPass: false,
      testResults: { total: 0, passed: 0, failed: 0 },
      error: raw.stderr || `Process exited with code ${raw.exitCode}`,
    };
  }

  // Try to parse as JSON
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

    // Snapshot changed files before execution to diff later
    const filesBefore = new Set(detectChangedFiles(this.projectRoot));

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
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
        if (this.verbose) {
          process.stderr.write(`[forge:stderr] ${data.toString()}`);
        }
      });

      proc.on("close", (code) => {
        if (this.verbose) {
          process.stderr.write(`[forge] Process exited with code ${code}, stdout ${stdout.length} bytes\n`);
        }
        const raw: RawClaudeOutput = {
          stdout,
          stderr,
          exitCode: code ?? 1,
        };
        const response = parseClaudeResponse(raw);

        // Detect files changed by this execution via git
        if (response.status === "success" && response.filesModified.length === 0) {
          const filesAfter = detectChangedFiles(this.projectRoot);
          const newFiles = filesAfter.filter((f) => !filesBefore.has(f));
          if (newFiles.length > 0) {
            response.filesModified = newFiles;
            if (this.verbose) {
              process.stderr.write(`[forge] Detected ${newFiles.length} changed files via git: ${newFiles.join(", ")}\n`);
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
