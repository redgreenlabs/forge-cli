import { describe, it, expect } from "vitest";
import {
  CommitOrchestrator,
  CommitPlan,
  CommitPhase,
} from "../../src/commits/orchestrator.js";
import { TddPhase } from "../../src/tdd/enforcer.js";

describe("Commit Orchestrator", () => {
  describe("phase-based commit planning", () => {
    it("should strip test-related prefix in Red phase (type already says test)", () => {
      const plan = CommitOrchestrator.planForPhase(TddPhase.Red, {
        taskId: "task-1",
        files: ["tests/auth.test.ts"],
        description: "Add login validation tests",
      });
      expect(plan.type).toBe("test");
      expect(plan.message).toContain("test:");
      // "Add login validation tests" → strip "Add...tests" → "login validation"
      expect(plan.message).toContain("login validation");
    });

    it("should strip implementation prefix in Green phase (type already says feat)", () => {
      const plan = CommitOrchestrator.planForPhase(TddPhase.Green, {
        taskId: "task-1",
        files: ["src/auth/login.ts"],
        description: "Implement login handler",
      });
      expect(plan.type).toBe("feat");
      expect(plan.message).toContain("feat(auth):");
      // "Implement login handler" → strip "Implement" → "login handler"
      expect(plan.message).toContain("login handler");
    });

    it("should keep specific action verbs in Refactor phase", () => {
      const plan = CommitOrchestrator.planForPhase(TddPhase.Refactor, {
        taskId: "task-1",
        files: ["src/auth/login.ts"],
        description: "Extract validation logic",
      });
      expect(plan.type).toBe("refactor");
      expect(plan.message).toContain("refactor(auth):");
      // "Extract validation logic" → keep "extract" (specific action)
      expect(plan.message).toContain("extract validation logic");
    });

    it("should strip 'refactor' prefix in Refactor phase since type already says it", () => {
      const plan = CommitOrchestrator.planForPhase(TddPhase.Refactor, {
        taskId: "task-1",
        files: ["src/auth/login.ts"],
        description: "Refactor authentication flow",
      });
      // "Refactor authentication flow" → strip "Refactor" → "authentication flow"
      expect(plan.message).toContain("refactor(auth): authentication flow");
    });

    it("should preserve description context across phases", () => {
      const plan = CommitOrchestrator.planForPhase(TddPhase.Green, {
        taskId: "task-1",
        files: [],
        description: "Implement user authentication with OAuth2",
      });
      // "Implement user auth..." → strip "Implement" → "user authentication with OAuth2"
      expect(plan.message).toContain("user authentication with OAuth2");
    });

    it("should include task title in commit body", () => {
      const plan = CommitOrchestrator.planForPhase(TddPhase.Green, {
        taskId: "task-1",
        files: ["src/models/scan_node.dart"],
        description: "Define ScanNode tree model with recursive size",
      });
      expect(plan.message).toContain("Task: Define ScanNode tree model");
    });

    it("should produce different subjects for Red vs Green on same task", () => {
      const red = CommitOrchestrator.planForPhase(TddPhase.Red, {
        taskId: "task-1",
        files: ["test/models/scan_node_test.dart"],
        description: "Define ScanNode model",
      });
      const green = CommitOrchestrator.planForPhase(TddPhase.Green, {
        taskId: "task-1",
        files: ["lib/models/scan_node.dart"],
        description: "Define ScanNode model",
      });
      // Red keeps full description (no test-prefix to strip)
      // Green keeps full description (no impl-prefix to strip)
      // But commit types differ: test: vs feat:
      expect(red.message).not.toBe(green.message);
      expect(red.message).toMatch(/^test[:(]/);
      expect(green.message).toMatch(/^feat[:(]/);
    });

    it("should handle 'Add failing tests for' prefix in Red phase", () => {
      const plan = CommitOrchestrator.planForPhase(TddPhase.Red, {
        files: ["tests/parser.test.ts"],
        description: "Add failing tests for JSON parser edge cases",
      });
      // "Add failing tests for JSON parser edge cases" → "jSON parser edge cases"
      expect(plan.message).toMatch(/test:.*json parser edge cases/i);
    });

    it("should handle 'Create' prefix in Green phase", () => {
      const plan = CommitOrchestrator.planForPhase(TddPhase.Green, {
        files: ["src/db/migration.ts"],
        description: "Create database migration runner",
      });
      // "Create database migration runner" → strip "Create" → "database migration runner"
      expect(plan.message).toContain("database migration runner");
    });

    it("should not strip everything when description IS the prefix", () => {
      const plan = CommitOrchestrator.planForPhase(TddPhase.Green, {
        files: ["src/utils.ts"],
        description: "Add",
      });
      // Should not produce empty subject
      expect(plan.message).toContain("feat:");
      expect(plan.message.split(":")[1]!.trim().length).toBeGreaterThan(0);
    });

    it("should truncate long descriptions to ~50 chars", () => {
      const plan = CommitOrchestrator.planForPhase(TddPhase.Green, {
        files: ["src/pipeline.ts"],
        description: "Implement the complete data processing pipeline with validation, transformation, and output formatting stages",
      });
      // Subject line (first line) should be reasonable length
      const subject = plan.message.split("\n")[0]!;
      expect(subject.length).toBeLessThan(80);
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
