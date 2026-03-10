import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ClaudeCodeExecutor,
  parseClaudeResponse,
  buildClaudeArgs,
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

    it("should extract files modified from status block", () => {
      const raw: RawClaudeOutput = {
        stdout: JSON.stringify({
          result: `---FORGE_STATUS---
FILES_MODIFIED: 3
EXIT_SIGNAL: false
---END_FORGE_STATUS---`,
          exitCode: 0,
        }),
        stderr: "",
        exitCode: 0,
      };

      const result = parseClaudeResponse(raw);
      expect(result.filesModified.length).toBe(3);
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
  });
});
