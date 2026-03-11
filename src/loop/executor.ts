import type { ClaudeResponse } from "./orchestrator.js";

/** Options for building Claude CLI arguments */
export interface ClaudeExecOptions {
  prompt: string;
  systemPrompt: string;
  allowedTools: string[];
  timeout: number;
  sessionId?: string;
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

  // Prompt
  args.push("-p", options.prompt);

  // Output format
  args.push("--output-format", "json");

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
 * Claude Code executor that spawns the CLI process.
 *
 * Uses `child_process.spawn` to run `claude` with constructed arguments.
 * Captures stdout/stderr and parses the response.
 */
export class ClaudeCodeExecutor {
  private claudeCmd: string;

  constructor(claudeCmd: string = "claude") {
    this.claudeCmd = claudeCmd;
  }

  async execute(options: ClaudeExecOptions): Promise<ClaudeResponse> {
    const args = buildClaudeArgs(options);

    const { spawn } = await import("child_process");

    return new Promise((resolve) => {
      const proc = spawn(this.claudeCmd, args, {
        timeout: options.timeout,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        const raw: RawClaudeOutput = {
          stdout,
          stderr,
          exitCode: code ?? 1,
        };
        resolve(parseClaudeResponse(raw));
      });

      proc.on("error", (err) => {
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
