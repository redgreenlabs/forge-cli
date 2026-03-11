import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  IterationPipeline,
  type PipelinePhaseResult,
  type PipelineConfig,
  type PhaseExecutor,
} from "../../src/loop/pipeline.js";
import { TddPhase } from "../../src/tdd/enforcer.js";
import { LoopPhase } from "../../src/loop/engine.js";

describe("Iteration Pipeline", () => {
  let executor: PhaseExecutor;
  let onPhaseChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    executor = {
      executeRedPhase: vi.fn().mockResolvedValue({
        filesModified: ["tests/auth.test.ts"],
        testsPass: false,
        testResults: { total: 1, passed: 0, failed: 1 },
        error: null,
      }),
      executeGreenPhase: vi.fn().mockResolvedValue({
        filesModified: ["src/auth.ts"],
        testsPass: true,
        testResults: { total: 1, passed: 1, failed: 0 },
        error: null,
      }),
      executeRefactorPhase: vi.fn().mockResolvedValue({
        filesModified: ["src/auth.ts"],
        testsPass: true,
        testResults: { total: 1, passed: 1, failed: 0 },
        error: null,
      }),
      runSecurityScan: vi.fn().mockResolvedValue({
        findings: [],
        passed: true,
      }),
      runQualityGates: vi.fn().mockResolvedValue({
        passed: true,
        results: [],
        summary: { total: 0, passed: 0, failed: 0, warnings: 0, errors: 0 },
        totalDurationMs: 0,
      }),
      executeCommit: vi.fn().mockResolvedValue({
        committed: true,
        message: "test(auth): add auth tests",
      }),
    };
    onPhaseChange = vi.fn();
  });

  function createPipeline(overrides: Partial<PipelineConfig> = {}): IterationPipeline {
    return new IterationPipeline({
      tddEnabled: true,
      securityEnabled: true,
      qualityGatesEnabled: true,
      autoCommit: true,
      ...overrides,
    });
  }

  describe("full TDD pipeline", () => {
    it("should execute Red → Green → Refactor phases in order", async () => {
      const pipeline = createPipeline();
      const result = await pipeline.execute(executor, onPhaseChange);

      expect(executor.executeRedPhase).toHaveBeenCalledTimes(1);
      expect(executor.executeGreenPhase).toHaveBeenCalledTimes(1);
      expect(executor.executeRefactorPhase).toHaveBeenCalledTimes(1);
    });

    it("should call phases in correct order", async () => {
      const callOrder: string[] = [];
      executor.executeRedPhase = vi.fn().mockImplementation(async () => {
        callOrder.push("red");
        return { filesModified: ["t.ts"], testsPass: false, testResults: { total: 1, passed: 0, failed: 1 }, error: null };
      });
      executor.executeGreenPhase = vi.fn().mockImplementation(async () => {
        callOrder.push("green");
        return { filesModified: ["s.ts"], testsPass: true, testResults: { total: 1, passed: 1, failed: 0 }, error: null };
      });
      executor.executeRefactorPhase = vi.fn().mockImplementation(async () => {
        callOrder.push("refactor");
        return { filesModified: ["s.ts"], testsPass: true, testResults: { total: 1, passed: 1, failed: 0 }, error: null };
      });
      executor.runSecurityScan = vi.fn().mockImplementation(async () => {
        callOrder.push("security");
        return { findings: [], passed: true };
      });
      executor.runQualityGates = vi.fn().mockImplementation(async () => {
        callOrder.push("gates");
        return { passed: true, results: [], summary: { total: 0, passed: 0, failed: 0, warnings: 0, errors: 0 }, totalDurationMs: 0 };
      });
      executor.executeCommit = vi.fn().mockImplementation(async () => {
        callOrder.push("commit");
        return { committed: true, message: "ok" };
      });

      const pipeline = createPipeline();
      await pipeline.execute(executor, onPhaseChange);

      expect(callOrder).toEqual(["red", "commit", "green", "commit", "security", "gates", "refactor", "commit"]);
    });

    it("should emit phase changes", async () => {
      const pipeline = createPipeline();
      await pipeline.execute(executor, onPhaseChange);

      const phases = onPhaseChange.mock.calls.map((c: [LoopPhase]) => c[0]);
      expect(phases).toContain(LoopPhase.Testing);
      expect(phases).toContain(LoopPhase.Implementing);
      expect(phases).toContain(LoopPhase.SecurityScan);
      expect(phases).toContain(LoopPhase.QualityGate);
      expect(phases).toContain(LoopPhase.Committing);
    });
  });

  describe("phase failure handling", () => {
    it("should stop pipeline if Red phase errors", async () => {
      executor.executeRedPhase = vi.fn().mockResolvedValue({
        filesModified: [],
        testsPass: false,
        testResults: { total: 0, passed: 0, failed: 0 },
        error: "Claude unavailable",
      });

      const pipeline = createPipeline();
      const result = await pipeline.execute(executor, onPhaseChange);

      expect(result.completed).toBe(false);
      expect(result.error).toContain("Red phase failed");
      expect(executor.executeGreenPhase).not.toHaveBeenCalled();
    });

    it("should stop pipeline if Green phase fails to pass tests", async () => {
      executor.executeGreenPhase = vi.fn().mockResolvedValue({
        filesModified: ["src/auth.ts"],
        testsPass: false,
        testResults: { total: 1, passed: 0, failed: 1 },
        error: null,
      });

      const pipeline = createPipeline();
      const result = await pipeline.execute(executor, onPhaseChange);

      expect(result.completed).toBe(false);
      expect(result.error).toContain("Green phase");
      expect(executor.executeRefactorPhase).not.toHaveBeenCalled();
    });

    it("should stop pipeline if quality gates fail with blocking severity", async () => {
      executor.runQualityGates = vi.fn().mockResolvedValue({
        passed: false,
        results: [{ name: "tests", status: "failed", message: "3 tests failing" }],
        summary: { total: 1, passed: 0, failed: 1, warnings: 0, errors: 0 },
        totalDurationMs: 100,
      });

      const pipeline = createPipeline();
      const result = await pipeline.execute(executor, onPhaseChange);

      expect(result.completed).toBe(false);
      expect(result.gatesPassed).toBe(false);
    });
  });

  describe("TDD disabled", () => {
    it("should skip Red phase when TDD is disabled", async () => {
      const pipeline = createPipeline({ tddEnabled: false });
      await pipeline.execute(executor, onPhaseChange);

      expect(executor.executeRedPhase).not.toHaveBeenCalled();
      expect(executor.executeGreenPhase).toHaveBeenCalled();
    });

    it("should skip Refactor phase when TDD is disabled", async () => {
      const pipeline = createPipeline({ tddEnabled: false });
      await pipeline.execute(executor, onPhaseChange);

      expect(executor.executeRefactorPhase).not.toHaveBeenCalled();
    });
  });

  describe("security disabled", () => {
    it("should skip security scan when disabled", async () => {
      const pipeline = createPipeline({ securityEnabled: false });
      await pipeline.execute(executor, onPhaseChange);

      expect(executor.runSecurityScan).not.toHaveBeenCalled();
    });
  });

  describe("auto-commit disabled", () => {
    it("should skip commits when autoCommit is false", async () => {
      const pipeline = createPipeline({ autoCommit: false });
      await pipeline.execute(executor, onPhaseChange);

      expect(executor.executeCommit).not.toHaveBeenCalled();
    });
  });

  describe("result tracking", () => {
    it("should track all files modified across phases", async () => {
      const pipeline = createPipeline();
      const result = await pipeline.execute(executor, onPhaseChange);

      expect(result.filesModified.length).toBeGreaterThan(0);
    });

    it("should track commit count", async () => {
      const pipeline = createPipeline();
      const result = await pipeline.execute(executor, onPhaseChange);

      // 3 commits: red, green, refactor
      expect(result.commitsCreated).toBe(3);
    });

    it("should track TDD phase transitions", async () => {
      const pipeline = createPipeline();
      const result = await pipeline.execute(executor, onPhaseChange);

      expect(result.tddPhasesCompleted).toEqual([
        TddPhase.Red,
        TddPhase.Green,
        TddPhase.Refactor,
      ]);
    });
  });
});
