import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LoopOrchestrator,
  type OrchestratorOptions,
  type ClaudeExecutor,
  type ClaudeResponse,
  type DashboardState,
} from "../../src/loop/orchestrator.js";
import { defaultConfig, AgentRole } from "../../src/config/schema.js";
import { TaskStatus, TaskPriority } from "../../src/prd/parser.js";
import { TddPhase } from "../../src/tdd/enforcer.js";
import { LoopPhase } from "../../src/loop/engine.js";

function makeClaudeResponse(overrides: Partial<ClaudeResponse> = {}): ClaudeResponse {
  return {
    status: "success",
    exitSignal: false,
    filesModified: ["src/feature.ts"],
    testsPass: true,
    testResults: { total: 5, passed: 5, failed: 0 },
    error: null,
    ...overrides,
  };
}

describe("Orchestrator Pipeline Integration", () => {
  let callCount: number;
  let executor: ClaudeExecutor;
  let dashboardStates: DashboardState[];

  beforeEach(() => {
    callCount = 0;
    dashboardStates = [];

    // The executor simulates the TDD cycle:
    // 1st call (Red): returns failing test
    // 2nd call (Green): returns passing implementation
    // 3rd call (Refactor): returns clean code
    executor = {
      execute: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount % 3 === 1) {
          // Red: write failing test
          return makeClaudeResponse({
            filesModified: ["tests/feature.test.ts"],
            testsPass: false,
            testResults: { total: 1, passed: 0, failed: 1 },
          });
        } else if (callCount % 3 === 2) {
          // Green: implement to pass
          return makeClaudeResponse({
            filesModified: ["src/feature.ts"],
            testsPass: true,
            testResults: { total: 1, passed: 1, failed: 0 },
          });
        } else {
          // Refactor: clean up
          return makeClaudeResponse({
            filesModified: ["src/feature.ts"],
            testsPass: true,
            testResults: { total: 1, passed: 1, failed: 0 },
          });
        }
      }),
    };
  });

  function createOrchestrator(
    overrides: Partial<OrchestratorOptions> = {}
  ): LoopOrchestrator {
    return new LoopOrchestrator({
      config: {
        ...defaultConfig,
        maxIterations: 2,
        agents: {
          team: [AgentRole.Tester, AgentRole.Implementer],
          soloMode: false,
        },
      },
      executor,
      tasks: [
        {
          id: "task-1",
          title: "Implement user login",
          status: TaskStatus.Pending,
          priority: TaskPriority.High,
          category: "features",
          acceptanceCriteria: ["Login works", "Tests pass"],
          dependsOn: [],
        },
      ],
      onDashboardUpdate: (state) => dashboardStates.push(state),
      ...overrides,
    });
  }

  describe("TDD iteration flow", () => {
    it("should call executor 3 times per iteration (Red, Green, Refactor)", async () => {
      const orch = createOrchestrator();
      await orch.runIteration();

      // Pipeline calls: Red + Green + Refactor = 3
      expect(executor.execute).toHaveBeenCalledTimes(3);
    });

    it("should emit dashboard updates during iteration", async () => {
      const orch = createOrchestrator();
      await orch.runIteration();

      // Should have multiple dashboard updates from pipeline phases
      expect(dashboardStates.length).toBeGreaterThan(1);
    });

    it("should track TDD phases in dashboard state", async () => {
      const orch = createOrchestrator();
      await orch.runIteration();

      // After full iteration with TDD, the enforcer should have progressed
      const lastState = dashboardStates[dashboardStates.length - 1]!;
      expect(lastState.tddPhase).toBeDefined();
    });

    it("should record files modified from all phases", async () => {
      const orch = createOrchestrator();
      await orch.runIteration();

      // Files from Red + Green + Refactor
      expect(orch.state.filesModifiedThisIteration).toBeGreaterThan(0);
    });
  });

  describe("TDD disabled flow", () => {
    it("should call executor once when TDD is disabled", async () => {
      const orch = createOrchestrator({
        config: {
          ...defaultConfig,
          maxIterations: 2,
          tdd: { ...defaultConfig.tdd, enabled: false },
        },
      });
      await orch.runIteration();

      // No Red or Refactor phase — just Green (implement)
      expect(executor.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe("error propagation", () => {
    it("should handle executor failure in Red phase", async () => {
      executor = {
        execute: vi.fn().mockRejectedValue(new Error("Network error")),
      };
      const orch = createOrchestrator({ executor });
      await orch.runIteration();

      // Should not throw, error handled internally
      expect(orch.state.iteration).toBe(1);
    });
  });

  describe("agent log tracking", () => {
    it("should log agent activity for each phase", async () => {
      const orch = createOrchestrator();
      await orch.runIteration();

      const log = orch.agentLog;
      expect(log.length).toBeGreaterThan(0);
      // Should have entries for task selection and phase completions
      expect(log.some((e) => e.action === "selected")).toBe(true);
    });
  });
});
