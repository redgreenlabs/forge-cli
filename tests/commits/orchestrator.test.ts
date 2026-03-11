import { describe, it, expect } from "vitest";
import {
  CommitOrchestrator,
  CommitPlan,
  CommitPhase,
} from "../../src/commits/orchestrator.js";
import { TddPhase } from "../../src/tdd/enforcer.js";

describe("Commit Orchestrator", () => {
  describe("phase-based commit planning", () => {
    it("should plan a test commit for TDD Red phase", () => {
      const plan = CommitOrchestrator.planForPhase(TddPhase.Red, {
        taskId: "task-1",
        files: ["tests/auth.test.ts"],
        description: "Add login validation tests",
      });
      expect(plan.type).toBe("test");
      expect(plan.message).toContain("test:");
      expect(plan.message).toContain("login validation");
    });

    it("should plan a feat commit for TDD Green phase", () => {
      const plan = CommitOrchestrator.planForPhase(TddPhase.Green, {
        taskId: "task-1",
        files: ["src/auth/login.ts"],
        description: "Implement login handler",
      });
      expect(plan.type).toBe("feat");
      expect(plan.message).toContain("feat(auth):");
    });

    it("should plan a refactor commit for TDD Refactor phase", () => {
      const plan = CommitOrchestrator.planForPhase(TddPhase.Refactor, {
        taskId: "task-1",
        files: ["src/auth/login.ts"],
        description: "Extract validation logic",
      });
      expect(plan.type).toBe("refactor");
      expect(plan.message).toContain("refactor(auth):");
    });
  });

  describe("commit atomicity", () => {
    it("should group files by logical change", () => {
      const groups = CommitOrchestrator.groupByLogicalChange([
        "src/auth/login.ts",
        "src/auth/register.ts",
        "tests/auth/login.test.ts",
        "tests/auth/register.test.ts",
        "src/db/schema.ts",
        "tests/db/schema.test.ts",
      ]);
      expect(groups).toHaveLength(2); // auth group + db group
      expect(groups[0]!.scope).toBe("auth");
      expect(groups[1]!.scope).toBe("db");
    });

    it("should keep test and source files together", () => {
      const groups = CommitOrchestrator.groupByLogicalChange([
        "src/utils/hash.ts",
        "tests/utils/hash.test.ts",
      ]);
      expect(groups).toHaveLength(1);
      expect(groups[0]!.files).toContain("src/utils/hash.ts");
      expect(groups[0]!.files).toContain("tests/utils/hash.test.ts");
    });

    it("should handle root-level files", () => {
      const groups = CommitOrchestrator.groupByLogicalChange([
        "README.md",
        "CHANGELOG.md",
      ]);
      expect(groups).toHaveLength(1);
      expect(groups[0]!.scope).toBe("root");
    });
  });

  describe("task reference", () => {
    it("should include task ID in commit message footer", () => {
      const plan = CommitOrchestrator.planForPhase(TddPhase.Green, {
        taskId: "US-3.2",
        files: ["src/agents/handoff.ts"],
        description: "Agent communication protocol",
      });
      expect(plan.message).toContain("US-3.2");
    });

    it("should omit task reference when no taskId provided", () => {
      const plan = CommitOrchestrator.planForPhase(TddPhase.Green, {
        files: ["src/utils.ts"],
        description: "Add utility functions",
      });
      expect(plan.message).not.toContain("Refs:");
    });
  });

  describe("scope detection", () => {
    it("should detect scope from file paths", () => {
      const scope = CommitOrchestrator.detectScope([
        "src/security/scanner.ts",
        "src/security/sast.ts",
      ]);
      expect(scope).toBe("security");
    });

    it("should use common parent when files span directories", () => {
      const scope = CommitOrchestrator.detectScope([
        "src/loop/engine.ts",
        "src/loop/runner.ts",
      ]);
      expect(scope).toBe("loop");
    });

    it("should return undefined for scattered files", () => {
      const scope = CommitOrchestrator.detectScope([
        "src/auth/login.ts",
        "src/db/schema.ts",
        "src/tui/dashboard.ts",
      ]);
      expect(scope).toBeUndefined();
    });
  });

  describe("squash planning", () => {
    it("should generate squash message from multiple commits", () => {
      const commits: CommitPlan[] = [
        { type: "test", message: "test(auth): add login tests", files: ["tests/auth/login.test.ts"], scope: "auth" },
        { type: "feat", message: "feat(auth): implement login", files: ["src/auth/login.ts"], scope: "auth" },
        { type: "refactor", message: "refactor(auth): extract validation", files: ["src/auth/login.ts"], scope: "auth" },
      ];
      const squashed = CommitOrchestrator.squash(commits, "Login feature");
      expect(squashed.type).toBe("feat");
      expect(squashed.message).toContain("feat(auth): Login feature");
      expect(squashed.files).toHaveLength(2); // deduped
    });

    it("should prefer feat type for squashed commits", () => {
      const commits: CommitPlan[] = [
        { type: "test", message: "test: add tests", files: ["t.ts"], scope: undefined },
        { type: "refactor", message: "refactor: clean up", files: ["r.ts"], scope: undefined },
      ];
      const squashed = CommitOrchestrator.squash(commits, "Improvements");
      expect(squashed.type).toBe("feat");
    });
  });
});
