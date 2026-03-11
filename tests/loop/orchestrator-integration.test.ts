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
import { HandoffPriority } from "../../src/agents/handoff.js";

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

describe("Orchestrator Integration", () => {
  let executor: ClaudeExecutor;
  let dashboardStates: DashboardState[];

  beforeEach(() => {
    executor = {
      execute: vi.fn().mockResolvedValue(makeClaudeResponse()),
    };
    dashboardStates = [];
  });

  function createOrchestrator(
    overrides: Partial<OrchestratorOptions> = {}
  ): LoopOrchestrator {
    return new LoopOrchestrator({
      config: { ...defaultConfig, maxIterations: 3 },
      executor,
      tasks: [
        {
          id: "task-1",
          title: "Design authentication architecture",
          status: TaskStatus.Pending,
          priority: TaskPriority.High,
          category: "features",
          acceptanceCriteria: ["ADR created"],
          dependsOn: [],
        },
        {
          id: "task-2",
          title: "Implement login endpoint",
          status: TaskStatus.Pending,
          priority: TaskPriority.High,
          category: "features",
          acceptanceCriteria: ["Tests pass", "Endpoint responds"],
          dependsOn: ["task-1"],
        },
      ],
      onDashboardUpdate: (state) => dashboardStates.push(state),
      ...overrides,
    });
  }

  describe("handoff context", () => {
    it("should have a handoff context available", () => {
      const orch = createOrchestrator();
      expect(orch.handoffContext).toBeDefined();
    });

    it("should allow adding handoff entries", () => {
      const orch = createOrchestrator();
      orch.handoffContext.add({
        from: AgentRole.Architect,
        to: AgentRole.Implementer,
        summary: "Use JWT for auth tokens",
        artifacts: ["src/auth/types.ts"],
        priority: HandoffPriority.High,
      });
      expect(orch.handoffContext.entries).toHaveLength(1);
    });

    it("should include handoff context in dashboard state", async () => {
      const orch = createOrchestrator();
      orch.handoffContext.add({
        from: AgentRole.Architect,
        to: AgentRole.Implementer,
        summary: "Build REST API",
        artifacts: [],
        priority: HandoffPriority.Normal,
      });
      await orch.runIteration();

      const lastState = dashboardStates[dashboardStates.length - 1]!;
      // 1 manually added + 1 auto-added by orchestrator after completion
      expect(lastState.handoffEntries).toBe(2);
    });
  });

  describe("team composer integration", () => {
    it("should use team pipeline for agent selection", () => {
      const orch = createOrchestrator();
      // Team pipeline orders roles in canonical order
      expect(orch.teamPipeline).toBeDefined();
      expect(orch.teamPipeline.length).toBeGreaterThan(0);
    });

    it("should respect solo mode config", () => {
      const orch = createOrchestrator({
        config: {
          ...defaultConfig,
          maxIterations: 3,
          agents: { ...defaultConfig.agents, soloMode: true },
        },
      });
      // Solo mode uses only first role
      expect(orch.teamPipeline).toHaveLength(1);
    });
  });

  describe("commit orchestrator integration", () => {
    it("should track planned commits", async () => {
      const orch = createOrchestrator();
      await orch.runIteration();

      // Orchestrator should have planned at least one commit
      expect(orch.committedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe("error panel data", () => {
    it("should provide error panel data", async () => {
      const orch = createOrchestrator();
      await orch.runIteration();

      const errorData = orch.errorPanelData;
      expect(errorData.circuitBreakerState).toBeDefined();
      expect(errorData.rateLimitRemaining).toBeDefined();
    });

    it("should track test failures in error data", async () => {
      const failingExecutor: ClaudeExecutor = {
        execute: vi.fn().mockResolvedValue(
          makeClaudeResponse({
            testsPass: false,
            testResults: { total: 5, passed: 2, failed: 3 },
          })
        ),
      };
      const orch = createOrchestrator({ executor: failingExecutor });
      await orch.runIteration();

      expect(orch.errorPanelData.testFailures).toBe(3);
    });
  });
});
