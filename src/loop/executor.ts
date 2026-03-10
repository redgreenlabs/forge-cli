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
  try {
    const parsed = JSON.parse(raw.stdout);

    if (Array.isArray(parsed)) {
      // CLI array format
      const resultEntry = parsed.find(
        (e: Record<string, unknown>) => e.type === "result"
      );
      resultText = (resultEntry?.result as string) ?? "";
    } else if (typeof parsed === "object" && parsed !== null) {
      // Flat object format
      resultText = (parsed.result as string) ?? "";
    }
  } catch {
    // Plain text fallback
    resultText = raw.stdout;
  }

  // Extract FORGE_STATUS block
  const statusBlock = extractStatusBlock(resultText);

  // Determine exit signal
  const exitSignal = statusBlock?.EXIT_SIGNAL === "true";

  // Determine test status
  const testsPass = statusBlock?.TESTS_STATUS
    ? statusBlock.TESTS_STATUS === "PASSING"
    : true;

  // Extract files modified count
  const filesModifiedCount = statusBlock?.FILES_MODIFIED
    ? parseInt(statusBlock.FILES_MODIFIED, 10)
    : 0;

  return {
    status: "success",
    exitSignal,
    filesModified: Array.from({ length: filesModifiedCount }, (_, i) => `file-${i}`),
    testsPass,
    testResults: { total: 0, passed: 0, failed: 0 },
    error: null,
  };
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
