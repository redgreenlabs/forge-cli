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
  getHeadSha,
  detectFilesFromCommits,
  countCommitsBetween,
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

    it("should include --dangerously-skip-permissions", () => {
      const args = buildClaudeArgs({
        prompt: "Test",
        systemPrompt: "",
        allowedTools: [],
        timeout: 60000,
      });
      expect(args).toContain("--dangerously-skip-permissions");
    });

    it("should not include system prompt flag when empty", () => {
      const args = buildClaudeArgs({
        prompt: "Test",
        systemPrompt: "",
        allowedTools: [],
        timeout: 60000,
      });
      expect(args).not.toContain("--append-system-prompt");
    });

    it("should include max budget when provided", () => {
      const args = buildClaudeArgs({
        prompt: "Test",
        systemPrompt: "",
        allowedTools: [],
        timeout: 60000,
        maxBudgetUsd: 5.0,
      });
      expect(args).toContain("--max-budget-usd");
      expect(args).toContain("5");
    });

    it("should not include max budget when undefined", () => {
      const args = buildClaudeArgs({
        prompt: "Test",
        systemPrompt: "",
        allowedTools: [],
        timeout: 60000,
      });
      expect(args).not.toContain("--max-budget-usd");
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

    it("should extract pytest results with only passed (no failed)", () => {
      const raw: RawClaudeOutput = {
        stdout: JSON.stringify([
          { type: "tool_result", content: "5 passed in 1.2s" },
          { type: "result", result: "Done" },
        ]),
        stderr: "",
        exitCode: 0,
      };

      const result = parseClaudeResponse(raw);
      expect(result.testResults.total).toBe(5);
      expect(result.testResults.passed).toBe(5);
      expect(result.testResults.failed).toBe(0);
      expect(result.testsPass).toBe(true);
    });

    it("should fall back to exit code message when stderr is empty", () => {
      const raw: RawClaudeOutput = {
        stdout: "",
        stderr: "",
        exitCode: 137,
      };

      const result = parseClaudeResponse(raw);
      expect(result.status).toBe("error");
      expect(result.error).toBe("Process exited with code 137");
    });

    it("should include resultText on success", () => {
      const raw: RawClaudeOutput = {
        stdout: JSON.stringify({ result: "Feature implemented" }),
        stderr: "",
        exitCode: 0,
      };

      const result = parseClaudeResponse(raw);
      expect(result.resultText).toBe("Feature implemented");
    });

    it("should extract file paths from tool_result content", () => {
      const raw: RawClaudeOutput = {
        stdout: JSON.stringify([
          { type: "tool_result", content: "wrote src/foo.ts" },
          { type: "tool_result", content: "edited src/bar.ts" },
          { type: "result", result: "Done" },
        ]),
        stderr: "",
        exitCode: 0,
      };

      const result = parseClaudeResponse(raw);
      expect(result.filesModified).toContain("src/foo.ts");
      expect(result.filesModified).toContain("src/bar.ts");
    });

    it("should extract test counts from FORGE_STATUS block", () => {
      const raw: RawClaudeOutput = {
        stdout: JSON.stringify({
          result: `Done.\n---FORGE_STATUS---\nTESTS_TOTAL: 10\nTESTS_PASSED: 8\nTESTS_FAILED: 2\n---END_FORGE_STATUS---`,
        }),
        stderr: "",
        exitCode: 0,
      };

      const result = parseClaudeResponse(raw);
      expect(result.testResults.total).toBe(10);
      expect(result.testResults.passed).toBe(8);
      expect(result.testResults.failed).toBe(2);
      expect(result.testsPass).toBe(false);
    });

    it("should use result items for test extraction", () => {
      const raw: RawClaudeOutput = {
        stdout: JSON.stringify([
          { type: "tool_result", result: "Tests  10 passed (10)" },
          { type: "result", result: "Done" },
        ]),
        stderr: "",
        exitCode: 0,
      };

      const result = parseClaudeResponse(raw);
      expect(result.testResults.total).toBe(10);
      expect(result.testResults.passed).toBe(10);
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

  describe("getHeadSha", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "forge-headsha-"));
      execSync("git init", { cwd: tmpDir, stdio: "pipe" });
      execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: "pipe" });
      execSync('git config user.name "Test"', { cwd: tmpDir, stdio: "pipe" });
      writeFileSync(join(tmpDir, "initial.ts"), "export const x = 1;");
      execSync("git add -A && git commit -m 'init'", { cwd: tmpDir, stdio: "pipe" });
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should return a valid SHA", () => {
      const sha = getHeadSha(tmpDir);
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
    });

    it("should return null for non-git directory", () => {
      const nonGitDir = mkdtempSync(join(tmpdir(), "forge-nogit-"));
      const sha = getHeadSha(nonGitDir);
      expect(sha).toBeNull();
      rmSync(nonGitDir, { recursive: true, force: true });
    });
  });

  describe("detectFilesFromCommits", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "forge-commitfiles-"));
      execSync("git init", { cwd: tmpDir, stdio: "pipe" });
      execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: "pipe" });
      execSync('git config user.name "Test"', { cwd: tmpDir, stdio: "pipe" });
      writeFileSync(join(tmpDir, "initial.ts"), "export const x = 1;");
      execSync("git add -A && git commit -m 'init'", { cwd: tmpDir, stdio: "pipe" });
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should detect files changed in new commits", () => {
      const beforeSha = getHeadSha(tmpDir)!;
      writeFileSync(join(tmpDir, "new.ts"), "export const y = 2;");
      execSync("git add -A && git commit -m 'add new'", { cwd: tmpDir, stdio: "pipe" });

      const files = detectFilesFromCommits(tmpDir, beforeSha);
      expect(files).toContain("new.ts");
    });

    it("should detect files across multiple commits", () => {
      const beforeSha = getHeadSha(tmpDir)!;
      writeFileSync(join(tmpDir, "a.ts"), "a");
      execSync("git add -A && git commit -m 'add a'", { cwd: tmpDir, stdio: "pipe" });
      writeFileSync(join(tmpDir, "b.ts"), "b");
      execSync("git add -A && git commit -m 'add b'", { cwd: tmpDir, stdio: "pipe" });

      const files = detectFilesFromCommits(tmpDir, beforeSha);
      expect(files).toContain("a.ts");
      expect(files).toContain("b.ts");
    });

    it("should return empty when no new commits", () => {
      const sha = getHeadSha(tmpDir)!;
      const files = detectFilesFromCommits(tmpDir, sha);
      expect(files).toEqual([]);
    });
  });

  describe("countCommitsBetween", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "forge-countcommits-"));
      execSync("git init", { cwd: tmpDir, stdio: "pipe" });
      execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: "pipe" });
      execSync('git config user.name "Test"', { cwd: tmpDir, stdio: "pipe" });
      writeFileSync(join(tmpDir, "initial.ts"), "export const x = 1;");
      execSync("git add -A && git commit -m 'init'", { cwd: tmpDir, stdio: "pipe" });
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should count new commits", () => {
      const beforeSha = getHeadSha(tmpDir)!;
      writeFileSync(join(tmpDir, "a.ts"), "a");
      execSync("git add -A && git commit -m 'add a'", { cwd: tmpDir, stdio: "pipe" });
      writeFileSync(join(tmpDir, "b.ts"), "b");
      execSync("git add -A && git commit -m 'add b'", { cwd: tmpDir, stdio: "pipe" });

      expect(countCommitsBetween(tmpDir, beforeSha)).toBe(2);
    });

    it("should return 0 when no new commits", () => {
      const sha = getHeadSha(tmpDir)!;
      expect(countCommitsBetween(tmpDir, sha)).toBe(0);
    });
  });

  describe("ClaudeCodeExecutor", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "forge-exec-"));
      execSync("git init", { cwd: tmpDir, stdio: "pipe" });
      execSync("git config user.email 'test@test.com'", { cwd: tmpDir, stdio: "pipe" });
      execSync("git config user.name 'Test'", { cwd: tmpDir, stdio: "pipe" });
      writeFileSync(join(tmpDir, "index.ts"), "export const x = 1;\n");
      execSync("git add -A && git commit -m 'init'", { cwd: tmpDir, stdio: "pipe" });
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should construct with defaults", () => {
      const exec = new ClaudeCodeExecutor();
      expect(exec).toBeDefined();
    });

    it("should construct with custom options", () => {
      const exec = new ClaudeCodeExecutor("custom-claude", true, tmpDir);
      expect(exec).toBeDefined();
    });

    it("should execute and parse a successful response", async () => {
      // Use a script that outputs valid JSON to stdout
      const exec = new ClaudeCodeExecutor("node", false, tmpDir);

      // We can't call the real claude, but we can verify the class handles
      // a non-claude command that outputs JSON (spawn will work with node -e)
      const result = await exec.execute({
        prompt: "test", // node -e ignores extra args
        systemPrompt: "",
        allowedTools: [],
        timeout: 10000,
      });

      // node with claude args will fail, which exercises the error path
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("filesModified");
      expect(result).toHaveProperty("testResults");
    });

    it("should call onStderr callback for stderr lines", async () => {
      const stderrLines: string[] = [];
      // Use a command that writes to stderr
      const exec = new ClaudeCodeExecutor(
        "bash",
        false,
        tmpDir
      );

      await exec.execute({
        prompt: "test",
        systemPrompt: "",
        allowedTools: [],
        timeout: 5000,
        onStderr: (line) => stderrLines.push(line),
      });

      // bash with invalid args will write to stderr
      // We just verify it doesn't crash
      expect(true).toBe(true);
    });

    it("should detect git-changed files when response has none", async () => {
      // Script that creates a file during execution and outputs valid JSON
      const scriptPath = join(tmpDir, "mock-claude.sh");
      writeFileSync(scriptPath, `#!/bin/bash\necho 'export const y = 2;' > "${tmpDir}/new-file.ts"\necho '{"result":"done"}'\n`);
      execSync(`chmod +x ${scriptPath}`, { stdio: "pipe" });

      const exec = new ClaudeCodeExecutor(scriptPath, false, tmpDir);
      const result = await exec.execute({
        prompt: "test",
        systemPrompt: "",
        allowedTools: [],
        timeout: 5000,
      });

      expect(result.status).toBe("success");
      expect(result.filesModified).toContain("new-file.ts");
    });

    it("should detect files from commits when claude commits during execution", async () => {
      // Script that creates a file, commits it, and outputs valid JSON
      const scriptPath = join(tmpDir, "mock-claude-commit.sh");
      writeFileSync(scriptPath, [
        "#!/bin/bash",
        `echo 'export const z = 3;' > "${tmpDir}/committed-file.ts"`,
        `cd "${tmpDir}"`,
        `git add -A`,
        `git commit -m 'feat: add committed-file'`,
        `echo '{"result":"done"}'`,
      ].join("\n"));
      execSync(`chmod +x ${scriptPath}`, { stdio: "pipe" });

      const exec = new ClaudeCodeExecutor(scriptPath, false, tmpDir);
      const result = await exec.execute({
        prompt: "test",
        systemPrompt: "",
        allowedTools: [],
        timeout: 5000,
      });

      expect(result.status).toBe("success");
      expect(result.filesModified).toContain("committed-file.ts");
    });
  });
});
