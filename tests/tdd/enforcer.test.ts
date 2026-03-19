import { describe, it, expect } from "vitest";
import {
  TddEnforcer,
  TddPhase,
  type TddCycleResult,
} from "../../src/tdd/enforcer.js";

describe("TddEnforcer", () => {
  describe("phase tracking", () => {
    it("should start in Red phase", () => {
      const enforcer = new TddEnforcer();
      expect(enforcer.currentPhase).toBe(TddPhase.Red);
    });

    it("should transition Red → Green on test failure then pass", () => {
      const enforcer = new TddEnforcer();

      // Red: write failing test
      enforcer.recordTestRun({ total: 1, passed: 0, failed: 1 });
      expect(enforcer.currentPhase).toBe(TddPhase.Green);
    });

    it("should transition Green → Refactor on tests passing", () => {
      const enforcer = new TddEnforcer();

      // Red: failing test
      enforcer.recordTestRun({ total: 1, passed: 0, failed: 1 });
      // Green: make it pass
      enforcer.recordTestRun({ total: 1, passed: 1, failed: 0 });
      expect(enforcer.currentPhase).toBe(TddPhase.Refactor);
    });

    it("should transition Refactor → Red to start next cycle", () => {
      const enforcer = new TddEnforcer();

      // Complete one cycle
      enforcer.recordTestRun({ total: 1, passed: 0, failed: 1 }); // Red→Green
      enforcer.recordTestRun({ total: 1, passed: 1, failed: 0 }); // Green→Refactor
      enforcer.completeCycle(); // Refactor→Red
      expect(enforcer.currentPhase).toBe(TddPhase.Red);
    });
  });

  describe("violation detection", () => {
    it("should flag writing code without a failing test first", () => {
      const enforcer = new TddEnforcer();

      // Skip Red phase — go straight to writing code
      const violation = enforcer.checkCodeChange({
        testFilesChanged: false,
        sourceFilesChanged: true,
        testsWereRun: false,
      });

      expect(violation).not.toBeNull();
      expect(violation?.type).toBe("code_before_test");
    });

    it("should allow writing tests in Red phase", () => {
      const enforcer = new TddEnforcer();

      const violation = enforcer.checkCodeChange({
        testFilesChanged: true,
        sourceFilesChanged: false,
        testsWereRun: false,
      });

      expect(violation).toBeNull();
    });

    it("should allow writing code in Green phase", () => {
      const enforcer = new TddEnforcer();
      enforcer.recordTestRun({ total: 1, passed: 0, failed: 1 });

      const violation = enforcer.checkCodeChange({
        testFilesChanged: false,
        sourceFilesChanged: true,
        testsWereRun: false,
      });

      expect(violation).toBeNull();
    });

    it("should flag if tests regress in Refactor phase", () => {
      const enforcer = new TddEnforcer();
      enforcer.recordTestRun({ total: 1, passed: 0, failed: 1 });
      enforcer.recordTestRun({ total: 1, passed: 1, failed: 0 });

      // In Refactor: tests should still pass
      const violation = enforcer.checkTestRegression({
        total: 1,
        passed: 0,
        failed: 1,
      });

      expect(violation).not.toBeNull();
      expect(violation?.type).toBe("regression_in_refactor");
    });

    it("should allow tests to stay green in Refactor phase", () => {
      const enforcer = new TddEnforcer();
      enforcer.recordTestRun({ total: 1, passed: 0, failed: 1 });
      enforcer.recordTestRun({ total: 1, passed: 1, failed: 0 });

      const violation = enforcer.checkTestRegression({
        total: 2,
        passed: 2,
        failed: 0,
      });

      expect(violation).toBeNull();
    });
  });

  describe("cycle tracking", () => {
    it("should count completed TDD cycles", () => {
      const enforcer = new TddEnforcer();

      enforcer.recordTestRun({ total: 1, passed: 0, failed: 1 });
      enforcer.recordTestRun({ total: 1, passed: 1, failed: 0 });
      enforcer.completeCycle();

      enforcer.recordTestRun({ total: 2, passed: 1, failed: 1 });
      enforcer.recordTestRun({ total: 2, passed: 2, failed: 0 });
      enforcer.completeCycle();

      expect(enforcer.completedCycles).toBe(2);
    });

    it("should track cycle history", () => {
      const enforcer = new TddEnforcer();

      enforcer.recordTestRun({ total: 1, passed: 0, failed: 1 });
      enforcer.recordTestRun({ total: 1, passed: 1, failed: 0 });
      enforcer.completeCycle();

      const history = enforcer.cycleHistory;
      expect(history).toHaveLength(1);
      expect(history[0]?.phases).toEqual([TddPhase.Red, TddPhase.Green, TddPhase.Refactor]);
    });
  });

  describe("commit type suggestions", () => {
    it("should suggest test: commit in Red phase", () => {
      const enforcer = new TddEnforcer();
      expect(enforcer.suggestedCommitType).toBe("test");
    });

    it("should suggest feat: commit in Green phase", () => {
      const enforcer = new TddEnforcer();
      enforcer.recordTestRun({ total: 1, passed: 0, failed: 1 });
      expect(enforcer.suggestedCommitType).toBe("feat");
    });

    it("should suggest refactor: commit in Refactor phase", () => {
      const enforcer = new TddEnforcer();
      enforcer.recordTestRun({ total: 1, passed: 0, failed: 1 });
      enforcer.recordTestRun({ total: 1, passed: 1, failed: 0 });
      expect(enforcer.suggestedCommitType).toBe("refactor");
    });
  });

  describe("advanceToPhase", () => {
    it("should advance from Red to Green", () => {
      const enforcer = new TddEnforcer();
      enforcer.advanceToPhase(TddPhase.Green);
      expect(enforcer.currentPhase).toBe(TddPhase.Green);
    });

    it("should advance from Red to Refactor (skipping Green)", () => {
      const enforcer = new TddEnforcer();
      enforcer.advanceToPhase(TddPhase.Refactor);
      expect(enforcer.currentPhase).toBe(TddPhase.Refactor);
    });

    it("should not go backwards from Green to Red", () => {
      const enforcer = new TddEnforcer();
      enforcer.advanceToPhase(TddPhase.Green);
      enforcer.advanceToPhase(TddPhase.Red);
      expect(enforcer.currentPhase).toBe(TddPhase.Green);
    });

    it("should be a no-op if already at target phase", () => {
      const enforcer = new TddEnforcer();
      enforcer.advanceToPhase(TddPhase.Red);
      expect(enforcer.currentPhase).toBe(TddPhase.Red);
    });

    it("should record skipped phases in cycle history", () => {
      const enforcer = new TddEnforcer();
      enforcer.advanceToPhase(TddPhase.Refactor);
      enforcer.completeCycle();
      const history = enforcer.cycleHistory;
      expect(history[0]?.phases).toContain(TddPhase.Red);
      expect(history[0]?.phases).toContain(TddPhase.Green);
      expect(history[0]?.phases).toContain(TddPhase.Refactor);
    });

    it("should not duplicate phases already recorded by recordTestRun", () => {
      const enforcer = new TddEnforcer();
      enforcer.recordTestRun({ total: 1, passed: 0, failed: 1 }); // Red → Green
      enforcer.advanceToPhase(TddPhase.Green); // Should be no-op (already there)
      enforcer.advanceToPhase(TddPhase.Refactor);
      enforcer.completeCycle();
      const history = enforcer.cycleHistory;
      // Red should appear exactly once
      expect(history[0]?.phases.filter(p => p === TddPhase.Red)).toHaveLength(1);
    });
  });

  describe("serialization", () => {
    it("should serialize and restore state", () => {
      const enforcer = new TddEnforcer();
      enforcer.recordTestRun({ total: 1, passed: 0, failed: 1 });

      const json = enforcer.toJSON();
      const restored = TddEnforcer.fromJSON(json);

      expect(restored.currentPhase).toBe(TddPhase.Green);
      expect(restored.completedCycles).toBe(0);
    });
  });
});
