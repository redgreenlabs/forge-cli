import { describe, it, expect } from "vitest";
import { LoopPhase } from "../../src/loop/engine.js";
import { CircuitBreakerState } from "../../src/loop/circuit-breaker.js";
import { TddPhase } from "../../src/tdd/enforcer.js";
import type { DashboardState } from "../../src/loop/orchestrator.js";
import { GateStatus } from "../../src/gates/quality-gates.js";
import type { CoverageMetrics, SecurityMetrics, CostMetrics } from "../../src/tui/renderer.js";

/** Helper to build a minimal DashboardState for tests */
function makeDashState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    loop: {
      iteration: 1,
      phase: LoopPhase.Implementing,
      running: true,
      tasksCompleted: 2,
      totalTasks: 5,
      filesModifiedThisIteration: 3,
      completedTaskIds: new Set(["t1", "t2"]),
      circuitBreakerState: CircuitBreakerState.Closed,
      startedAt: Date.now() - 60_000,
      lastIterationAt: Date.now(),
    },
    tddPhase: TddPhase.Green,
    tddCycles: 1,
    agentLog: [],
    handoffEntries: 0,
    commitCount: 4,
    claudeLogs: [],
    ...overrides,
  };
}

describe("live-dashboard module", () => {
  it("should export startLiveDashboard, Dashboard, CoveragePanel, SecurityPanel", async () => {
    const mod = await import("../../src/tui/live-dashboard.js");
    expect(typeof mod.startLiveDashboard).toBe("function");
    expect(typeof mod.Dashboard).toBe("function");
    expect(typeof mod.CoveragePanel).toBe("function");
    expect(typeof mod.SecurityPanel).toBe("function");
  });

  it("should export DashboardUpdater type (function signature check)", async () => {
    const mod = await import("../../src/tui/live-dashboard.js");
    // startLiveDashboard accepts DashboardState and returns { updater, cleanup }
    expect(mod.startLiveDashboard.length).toBeGreaterThanOrEqual(1);
  });
});

describe("DashboardState interface", () => {
  it("should accept minimal state without optional fields", () => {
    const state = makeDashState();
    expect(state.loop.phase).toBe(LoopPhase.Implementing);
    expect(state.coverage).toBeUndefined();
    expect(state.security).toBeUndefined();
    expect(state.codeMetrics).toBeUndefined();
    expect(state.qualityReport).toBeUndefined();
    expect(state.cost).toBeUndefined();
  });

  it("should accept coverage metrics", () => {
    const coverage: CoverageMetrics = {
      lines: 85,
      branches: 72,
      functions: 90,
      trend: "up",
    };
    const state = makeDashState({ coverage });
    expect(state.coverage).toEqual(coverage);
    expect(state.coverage?.trend).toBe("up");
  });

  it("should accept security metrics with no findings", () => {
    const security: SecurityMetrics = { critical: 0, high: 0, medium: 0, low: 0 };
    const state = makeDashState({ security });
    expect(state.security).toEqual(security);
  });

  it("should accept security metrics with findings", () => {
    const security: SecurityMetrics = { critical: 1, high: 3, medium: 5, low: 2 };
    const state = makeDashState({ security });
    expect(state.security?.critical).toBe(1);
    expect(state.security?.high).toBe(3);
  });

  it("should accept quality report with gate results", () => {
    const state = makeDashState({
      qualityReport: {
        passed: false,
        results: [
          { name: "tests-pass", status: GateStatus.Passed, message: "All pass", durationMs: 100 },
          { name: "linting", status: GateStatus.Failed, message: "Issues found", durationMs: 50 },
        ],
        summary: { total: 2, passed: 1, failed: 1, warnings: 0, errors: 0 },
        totalDurationMs: 150,
      },
    });
    expect(state.qualityReport?.passed).toBe(false);
    expect(state.qualityReport?.results).toHaveLength(2);
  });

  it("should accept agent log entries", () => {
    const state = makeDashState({
      agentLog: [
        { timestamp: Date.now(), agent: "implementer", action: "green-phase", detail: "Implementing" },
        { timestamp: Date.now(), agent: "tester", action: "red-phase", detail: "Writing test" },
        { timestamp: Date.now(), agent: "system", action: "commit", detail: "feat: add feature" },
      ],
    });
    expect(state.agentLog).toHaveLength(3);
    expect(state.agentLog[0]?.agent).toBe("implementer");
  });

  it("should accept code metrics", () => {
    const state = makeDashState({
      codeMetrics: {
        testRatio: 1.2,
        sourceFiles: 40,
        testFiles: 48,
        averageComplexity: 4.5,
        highComplexityCount: 2,
      },
    });
    expect(state.codeMetrics?.testRatio).toBe(1.2);
    expect(state.codeMetrics?.highComplexityCount).toBe(2);
  });

  it("should accept cost metrics", () => {
    const cost: CostMetrics = {
      totalUsd: 1.234,
      currentTaskUsd: 0.456,
      perPhase: { implementing: 0.8, testing: 0.3, quality_gate: 0.134 },
      executions: 12,
      completedTasks: 3,
    };
    const state = makeDashState({ cost });
    expect(state.cost).toEqual(cost);
    expect(state.cost?.totalUsd).toBe(1.234);
    expect(state.cost?.executions).toBe(12);
    expect(state.cost?.perPhase.implementing).toBe(0.8);
  });

  it("should compute average cost per task from cost metrics", () => {
    const cost: CostMetrics = {
      totalUsd: 3.0,
      currentTaskUsd: 0.5,
      perPhase: {},
      executions: 15,
      completedTasks: 6,
    };
    const avgPerTask = cost.completedTasks > 0 ? cost.totalUsd / cost.completedTasks : 0;
    expect(avgPerTask).toBe(0.5);
  });

  it("should compute average cost per call from cost metrics", () => {
    const cost: CostMetrics = {
      totalUsd: 2.0,
      currentTaskUsd: 0.1,
      perPhase: {},
      executions: 10,
      completedTasks: 4,
    };
    const avgPerCall = cost.executions > 0 ? cost.totalUsd / cost.executions : 0;
    expect(avgPerCall).toBe(0.2);
  });

  it("should accept rateLimitWaiting with until timestamp", () => {
    const until = Date.now() + 300_000; // 5 minutes from now
    const state = makeDashState({
      rateLimitWaiting: { until, reason: "API rate limit reached" },
    });
    expect(state.rateLimitWaiting).toBeDefined();
    expect(state.rateLimitWaiting?.until).toBe(until);
    expect(state.rateLimitWaiting?.reason).toBe("API rate limit reached");
  });

  it("should have rateLimitWaiting undefined by default", () => {
    const state = makeDashState();
    expect(state.rateLimitWaiting).toBeUndefined();
  });

  it("should compute correct countdown from rateLimitWaiting.until", () => {
    const until = Date.now() + 3_661_000; // ~1h 1m 1s from now
    const state = makeDashState({
      rateLimitWaiting: { until, reason: "API rate limit reached" },
    });

    const remainingMs = Math.max(0, state.rateLimitWaiting!.until - Date.now());
    const totalSec = Math.ceil(remainingMs / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);

    expect(hours).toBe(1);
    expect(minutes).toBeGreaterThanOrEqual(0);
    expect(minutes).toBeLessThanOrEqual(1);
  });

  it("should handle rateLimitWaiting with expired timestamp", () => {
    const until = Date.now() - 1000; // Already expired
    const state = makeDashState({
      rateLimitWaiting: { until, reason: "API rate limit reached" },
    });

    const remainingMs = Math.max(0, state.rateLimitWaiting!.until - Date.now());
    expect(remainingMs).toBe(0);
  });

  it("should accept all fields together including cost", () => {
    const state = makeDashState({
      currentTask: "Implement login form",
      coverage: { lines: 82, branches: 70, functions: 88, trend: "stable" },
      security: { critical: 0, high: 0, medium: 1, low: 3 },
      codeMetrics: {
        testRatio: 0.95,
        sourceFiles: 30,
        testFiles: 28,
        averageComplexity: 6.2,
        highComplexityCount: 1,
      },
      qualityReport: {
        passed: true,
        results: [
          { name: "tests-pass", status: GateStatus.Passed, message: "OK", durationMs: 200 },
        ],
        summary: { total: 1, passed: 1, failed: 0, warnings: 0, errors: 0 },
        totalDurationMs: 200,
      },
      cost: {
        totalUsd: 0.567,
        currentTaskUsd: 0.123,
        perPhase: { implementing: 0.4, testing: 0.167 },
        executions: 5,
        completedTasks: 2,
      },
    });
    expect(state.currentTask).toBe("Implement login form");
    expect(state.coverage?.lines).toBe(82);
    expect(state.security?.medium).toBe(1);
    expect(state.codeMetrics?.averageComplexity).toBe(6.2);
    expect(state.cost?.totalUsd).toBe(0.567);
  });
});
