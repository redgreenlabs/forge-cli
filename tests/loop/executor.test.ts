import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import {
  ClaudeCodeExecutor,
  parseClaudeResponse,
  buildClaudeArgs,
  detectChangedFiles,
  type ClaudeExecOptions,
  type RawClaudeOutput,
} from "../../src/loop/executor.js";

describe("Claude Code Executor", () => {
  describe("buildClaudeArgs", () => {
    it("should include output format json", () => {
      const args = buildClaudeArgs({
        prompt: "Do something",
        systemPrompt: "You are helpful",
        allowedTools: ["Read", "Write"],
        timeout: 900000,
      });
      expect(args).toContain("--output-format");
      expect(args).toContain("json");
    });

    it("should include allowed tools", () => {
      const args = buildClaudeArgs({
        prompt: "Test",
        systemPrompt: "Agent",
        allowedTools: ["Read", "Write", "Bash(npm test)"],
        timeout: 60000,
      });
      expect(args).toContain("--allowedTools");
      expect(args.some((a) => a.includes("Read"))).toBe(true);
    });

    it("should include system prompt via --append-system-prompt", () => {
      const args = buildClaudeArgs({
        prompt: "Test",
        systemPrompt: "Be careful",
        allowedTools: [],
        timeout: 60000,
      });
      expect(args).toContain("--append-system-prompt");
    });

    it("should include prompt via -p flag", () => {
      const args = buildClaudeArgs({
        prompt: "Implement the feature",
        systemPrompt: "",
        allowedTools: [],
        timeout: 60000,
      });
      expect(args).toContain("-p");
      expect(args).toContain("Implement the feature");
    });

    it("should include session continuation flag", () => {
      const args = buildClaudeArgs({
        prompt: "Test",
        systemPrompt: "",
        allowedTools: [],
        timeout: 60000,
        sessionId: "session-123",
      });
      expect(args).toContain("--continue");
      expect(args).toContain("session-123");
    });

    it("should not include session flag without session id", () => {
      const args = buildClaudeArgs({
        prompt: "Test",
        systemPrompt: "",
        allowedTools: [],
        timeout: 60000,
      });
      expect(args).not.toContain("--continue");
    });
  });

  describe("parseClaudeResponse", () => {
    it("should parse flat JSON response", () => {
      const raw: RawClaudeOutput = {
        stdout: JSON.stringify({
          result: "Implemented the feature",
          exitCode: 0,
        }),
        stderr: "",
        exitCode: 0,
      };

      const result = parseClaudeResponse(raw);
      expect(result.status).toBe("success");
      expect(result.error).toBeNull();
    });

    it("should parse Claude CLI JSON array format", () => {
      const raw: RawClaudeOutput = {
        stdout: JSON.stringify([
          { type: "system", content: "..." },
          {
            type: "result",
            result: "Done with task",
            subtype: "success",
          },
        ]),
        stderr: "",
        exitCode: 0,
      };

      const result = parseClaudeResponse(raw);
      expect(result.status).toBe("success");
    });

    it("should detect exit signal from FORGE_STATUS block", () => {
      const raw: RawClaudeOutput = {
        stdout: JSON.stringify({
          result: `I completed everything.
---FORGE_STATUS---
STATUS: COMPLETE
TASKS_COMPLETED_THIS_LOOP: 3
FILES_MODIFIED: 5
TESTS_STATUS: PASSING
EXIT_SIGNAL: true
RECOMMENDATION: All done
---END_FORGE_STATUS---`,
          exitCode: 0,
        }),
        stderr: "",
        exitCode: 0,
      };

      const result = parseClaudeResponse(raw);
      expect(result.exitSignal).toBe(true);
    });

    it("should detect exit signal false", () => {
      const raw: RawClaudeOutput = {
        stdout: JSON.stringify({
          result: `Working on it.
---FORGE_STATUS---
STATUS: IN_PROGRESS
EXIT_SIGNAL: false
---END_FORGE_STATUS---`,
          exitCode: 0,
        }),
        stderr: "",
        exitCode: 0,
      };

      const result = parseClaudeResponse(raw);
      expect(result.exitSignal).toBe(false);
    });

    it("should extract file paths from tool_use entries", () => {
      const raw: RawClaudeOutput = {
        stdout: JSON.stringify([
          {
            type: "assistant",
            content: [
              {
                type: "tool_use",
                name: "Write",
                input: { file_path: "src/auth.ts", content: "export const auth = true;" },
              },
              {
                type: "tool_use",
                name: "Edit",
                input: { file_path: "src/login.ts", old_string: "a", new_string: "b" },
              },
            ],
          },
          { type: "result", result: "Done" },
        ]),
        stderr: "",
        exitCode: 0,
      };

      const result = parseClaudeResponse(raw);
      expect(result.filesModified).toContain("src/auth.ts");
      expect(result.filesModified).toContain("src/login.ts");
      expect(result.filesModified.length).toBe(2);
    });

    it("should deduplicate file paths", () => {
      const raw: RawClaudeOutput = {
        stdout: JSON.stringify([
          {
            type: "assistant",
            content: [
              { type: "tool_use", name: "Edit", input: { file_path: "src/app.ts" } },
              { type: "tool_use", name: "Edit", input: { file_path: "src/app.ts" } },
            ],
          },
          { type: "result", result: "Done" },
        ]),
        stderr: "",
        exitCode: 0,
      };

      const result = parseClaudeResponse(raw);
      expect(result.filesModified).toEqual(["src/app.ts"]);
    });

    it("should return empty files when no tool_use entries", () => {
      const raw: RawClaudeOutput = {
        stdout: JSON.stringify({ result: "Just text" }),
        stderr: "",
        exitCode: 0,
      };

      const result = parseClaudeResponse(raw);
      expect(result.filesModified).toEqual([]);
    });

    it("should handle non-zero exit code as error", () => {
      const raw: RawClaudeOutput = {
        stdout: "",
        stderr: "Error: timeout exceeded",
        exitCode: 124,
      };

      const result = parseClaudeResponse(raw);
      expect(result.status).toBe("error");
      expect(result.error).toContain("timeout");
    });

    it("should handle unparseable output gracefully", () => {
      const raw: RawClaudeOutput = {
        stdout: "not json at all",
        stderr: "",
        exitCode: 0,
      };

      const result = parseClaudeResponse(raw);
      expect(result.status).toBe("success");
      // Falls back to text parsing
    });

    it("should extract test status from status block", () => {
      const raw: RawClaudeOutput = {
        stdout: JSON.stringify({
          result: `---FORGE_STATUS---
TESTS_STATUS: FAILING
EXIT_SIGNAL: false
---END_FORGE_STATUS---`,
          exitCode: 0,
        }),
        stderr: "",
        exitCode: 0,
      };

      const result = parseClaudeResponse(raw);
      expect(result.testsPass).toBe(false);
    });

    it("should extract vitest results from tool output", () => {
      const raw: RawClaudeOutput = {
        stdout: JSON.stringify([
          {
            type: "tool_result",
            content: "Tests  42 passed (42)\nDuration  1.5s",
          },
          { type: "result", result: "All tests pass" },
        ]),
        stderr: "",
        exitCode: 0,
      };

      const result = parseClaudeResponse(raw);
      expect(result.testResults.total).toBe(42);
      expect(result.testResults.passed).toBe(42);
      expect(result.testResults.failed).toBe(0);
      expect(result.testsPass).toBe(true);
    });

    it("should extract jest results from tool output", () => {
      const raw: RawClaudeOutput = {
        stdout: JSON.stringify([
          {
            type: "tool_result",
            content: "Tests: 10 passed, 2 failed, 12 total",
          },
          { type: "result", result: "Some tests failed" },
        ]),
        stderr: "",
        exitCode: 0,
      };

      const result = parseClaudeResponse(raw);
      expect(result.testResults.total).toBe(12);
      expect(result.testResults.passed).toBe(10);
      expect(result.testResults.failed).toBe(2);
      expect(result.testsPass).toBe(false);
    });

    it("should extract pytest results from tool output", () => {
      const raw: RawClaudeOutput = {
        stdout: JSON.stringify([
          {
            type: "tool_result",
            content: "8 passed, 1 failed in 2.3s",
          },
          { type: "result", result: "Done" },
        ]),
        stderr: "",
        exitCode: 0,
      };

      const result = parseClaudeResponse(raw);
      expect(result.testResults.total).toBe(9);
      expect(result.testResults.passed).toBe(8);
      expect(result.testResults.failed).toBe(1);
    });
  });

  describe("detectChangedFiles", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "forge-detect-"));
      execSync("git init", { cwd: tmpDir, stdio: "pipe" });
      execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: "pipe" });
      execSync('git config user.name "Test"', { cwd: tmpDir, stdio: "pipe" });
      writeFileSync(join(tmpDir, "initial.ts"), "export const x = 1;");
      execSync("git add -A && git commit -m 'init'", { cwd: tmpDir, stdio: "pipe" });
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should return empty when no changes", () => {
      const files = detectChangedFiles(tmpDir);
      expect(files).toEqual([]);
    });

    it("should detect new untracked files", () => {
      writeFileSync(join(tmpDir, "new-file.ts"), "export const y = 2;");
      const files = detectChangedFiles(tmpDir);
      expect(files).toContain("new-file.ts");
    });

    it("should detect modified files", () => {
      writeFileSync(join(tmpDir, "initial.ts"), "export const x = 99;");
      const files = detectChangedFiles(tmpDir);
      expect(files).toContain("initial.ts");
    });

    it("should detect files in subdirectories", () => {
      mkdirSync(join(tmpDir, "src"), { recursive: true });
      writeFileSync(join(tmpDir, "src/app.ts"), "export const app = true;");
      const files = detectChangedFiles(tmpDir);
      expect(files).toContain("src/app.ts");
    });

    it("should return empty for non-git directory", () => {
      const nonGitDir = mkdtempSync(join(tmpdir(), "forge-nogit-"));
      const files = detectChangedFiles(nonGitDir);
      expect(files).toEqual([]);
      rmSync(nonGitDir, { recursive: true, force: true });
    });
  });
});
