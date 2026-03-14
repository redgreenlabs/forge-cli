import { describe, it, expect } from "vitest";
import {
  renderCodeMetrics,
  renderDashboard,
  type CodeQualityMetrics,
} from "../../src/tui/renderer.js";
import { LoopPhase } from "../../src/loop/engine.js";
import { CircuitBreakerState } from "../../src/loop/circuit-breaker.js";
import { TddPhase } from "../../src/tdd/enforcer.js";

describe("renderCodeMetrics", () => {
  it("should render good metrics in green", () => {
    const metrics: CodeQualityMetrics = {
      testRatio: 1.2,
      sourceFiles: 10,
      testFiles: 12,
      averageComplexity: 3.5,
      highComplexityCount: 0,
    };
    const output = renderCodeMetrics(metrics);
    expect(output).toContain("Code Quality:");
    expect(output).toContain("1.20");
    expect(output).toContain("12 tests / 10 source");
    expect(output).toContain("3.5 avg");
  });

  it("should render low test ratio in red", () => {
    const metrics: CodeQualityMetrics = {
      testRatio: 0.3,
      sourceFiles: 20,
      testFiles: 6,
      averageComplexity: 4.0,
      highComplexityCount: 0,
    };
    const output = renderCodeMetrics(metrics);
    expect(output).toContain("0.30");
    expect(output).toContain("6 tests / 20 source");
  });

  it("should render medium test ratio in yellow", () => {
    const metrics: CodeQualityMetrics = {
      testRatio: 0.7,
      sourceFiles: 10,
      testFiles: 7,
      averageComplexity: 7.0,
      highComplexityCount: 0,
    };
    const output = renderCodeMetrics(metrics);
    expect(output).toContain("0.70");
  });

  it("should show high complexity warning", () => {
    const metrics: CodeQualityMetrics = {
      testRatio: 1.0,
      sourceFiles: 5,
      testFiles: 5,
      averageComplexity: 12.0,
      highComplexityCount: 3,
    };
    const output = renderCodeMetrics(metrics);
    expect(output).toContain("3 files above complexity threshold");
  });

  it("should use singular for 1 high complexity file", () => {
    const metrics: CodeQualityMetrics = {
      testRatio: 1.0,
      sourceFiles: 5,
      testFiles: 5,
      averageComplexity: 8.0,
      highComplexityCount: 1,
    };
    const output = renderCodeMetrics(metrics);
    expect(output).toContain("1 file above complexity threshold");
  });

  it("should not show warning when no high complexity files", () => {
    const metrics: CodeQualityMetrics = {
      testRatio: 1.0,
      sourceFiles: 5,
      testFiles: 5,
      averageComplexity: 3.0,
      highComplexityCount: 0,
    };
    const output = renderCodeMetrics(metrics);
    expect(output).not.toContain("above complexity threshold");
  });
});

describe("renderDashboard with codeMetrics", () => {
  it("should include code metrics panel when provided", () => {
    const output = renderDashboard({
      state: {
        iteration: 1,
        phase: LoopPhase.Implementing,
        running: true,
        tasksCompleted: 0,
        totalTasks: 2,
        completedTaskIds: new Set(),
        filesModifiedThisIteration: 3,
        circuitBreakerState: CircuitBreakerState.Closed,
        startedAt: Date.now(),
        lastIterationAt: null,
      },
      tddPhase: TddPhase.Green,
      tddCycles: 1,
      agentLog: [],
      codeMetrics: {
        testRatio: 0.85,
        sourceFiles: 20,
        testFiles: 17,
        averageComplexity: 5.2,
        highComplexityCount: 1,
      },
    });

    expect(output).toContain("Code Quality:");
    expect(output).toContain("0.85");
    expect(output).toContain("5.2 avg");
  });

  it("should omit code metrics panel when not provided", () => {
    const output = renderDashboard({
      state: {
        iteration: 1,
        phase: LoopPhase.Idle,
        running: false,
        tasksCompleted: 0,
        totalTasks: 1,
        completedTaskIds: new Set(),
        filesModifiedThisIteration: 0,
        circuitBreakerState: CircuitBreakerState.Closed,
        startedAt: Date.now(),
        lastIterationAt: null,
      },
      tddPhase: TddPhase.Red,
      tddCycles: 0,
      agentLog: [],
    });

    expect(output).not.toContain("Code Quality:");
  });
});
