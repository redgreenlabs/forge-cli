import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LoopOrchestrator,
  type OrchestratorOptions,
  type ClaudeExecutor,
  type ClaudeResponse,
} from "../../src/loop/orchestrator.js";
import { defaultConfig, AgentRole } from "../../src/config/schema.js";
import { LoopPhase } from "../../src/loop/engine.js";
import { TddPhase } from "../../src/tdd/enforcer.js";
import { TaskStatus, TaskPriority } from "../../src/prd/parser.js";

// Mock modules that spawn child processes (quality gates run `npm test`, `npm run lint`, etc.)
vi.mock("../../src/loop/phase-impl.js", () => ({
  scanFilesForSecurity: vi.fn().mockReturnValue({ passed: true, findings: [] }),
  runQualityGates: vi.fn().mockResolvedValue({
    passed: true,
    results: [],
    summary: { total: 0, passed: 0, failed: 0, warnings: 0, errors: 0 },
    totalDurationMs: 0,
  }),
  commitPhase: vi.fn().mockResolvedValue({ committed: true, message: "mock commit" }),
}));
vi.mock("../../src/gates/plugin.js", () => ({
  GatePluginRegistry: class MockRegistry {
    register() {}
    toGateDefinitions() { return []; }
  },
  createBuiltinGates: vi.fn().mockReturnValue([]),
}));

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

describe("LoopOrchestrator", () => {
  let executor: ClaudeExecutor;
  let onDashboardUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    executor = {
      execute: vi.fn().mockResolvedValue(makeClaudeResponse()),
    };
    onDashboardUpdate = vi.fn();
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
          title: "Implement feature",
          status: TaskStatus.Pending,
          priority: TaskPriority.High,
          category: "features",
          acceptanceCriteria: ["Tests pass"],
          dependsOn: [],
        },
        {
          id: "task-2",
          title: "Add error handling",
          status: TaskStatus.Pending,
          priority: TaskPriority.High,
          category: "features",
          acceptanceCriteria: ["Error cases covered"],
          dependsOn: ["task-1"],
        },
        {
          id: "task-3",
          title: "Write integration tests",
          status: TaskStatus.Pending,
          priority: TaskPriority.Medium,
          category: "testing",
          acceptanceCriteria: ["Integration tests pass"],
          dependsOn: ["task-2"],
        },
        {
          id: "task-4",
          title: "Add documentation",
          status: TaskStatus.Pending,
          priority: TaskPriority.Low,
          category: "docs",
          acceptanceCriteria: ["Docs complete"],
          dependsOn: ["task-3"],
        },
      ],
      onDashboardUpdate,
      ...overrides,
    });
  }

  describe("initialization", () => {
    it("should create with valid config", () => {
      const orch = createOrchestrator();
      expect(orch.state.iteration).toBe(0);
      expect(orch.state.phase).toBe(LoopPhase.Idle);
    });

    it("should track total tasks", () => {
      const orch = createOrchestrator();
      expect(orch.state.totalTasks).toBe(4);
    });
  });

  describe("agent selection", () => {
    it("should select appropriate agent for task", () => {
      const orch = createOrchestrator();
      const agent = orch.selectAgent("Write unit tests for auth module");
      expect(agent).toBe(AgentRole.Tester);
    });

    it("should select implementer for coding tasks", () => {
      const orch = createOrchestrator();
      const agent = orch.selectAgent("Implement the login endpoint");
      expect(agent).toBe(AgentRole.Implementer);
    });
  });

  describe("iteration execution", () => {
    it("should execute a single iteration", async () => {
      const orch = createOrchestrator();
      await orch.runIteration();

      expect(executor.execute).toHaveBeenCalled();
      expect(orch.state.iteration).toBe(1);
    });

    it("should pass through TDD phases", async () => {
      const orch = createOrchestrator();
      await orch.runIteration();

      // Dashboard should have been updated during the iteration
      expect(onDashboardUpdate).toHaveBeenCalled();
    });

    it("should update circuit breaker on each iteration", async () => {
      const orch = createOrchestrator();
      await orch.runIteration();
      // Circuit breaker records the iteration result
      expect(orch.circuitBreakerStats.totalIterations).toBe(1);
    });

    it("should handle executor errors gracefully", async () => {
      const failingExecutor: ClaudeExecutor = {
        execute: vi.fn().mockRejectedValue(new Error("Claude unavailable")),
      };
      const orch = createOrchestrator({ executor: failingExecutor });

      await orch.runIteration();
      expect(orch.state.iteration).toBe(1);
      // Should not throw, error handled internally
    });
  });

  describe("run loop", () => {
    it("should stop after max iterations", async () => {
      const orch = createOrchestrator();
      await orch.runLoop();

      expect(orch.state.iteration).toBe(3);
      expect(orch.stopReason).toBe("max_iterations_reached");
    });

    it("should stop when all tasks complete", async () => {
      const completingExecutor: ClaudeExecutor = {
        execute: vi.fn().mockResolvedValue(
          makeClaudeResponse({ exitSignal: true })
        ),
      };
      const orch = createOrchestrator({ executor: completingExecutor });

      // Mark all tasks complete after first iteration
      await orch.runIteration();
      orch.markTaskComplete("task-1");
      orch.markTaskComplete("task-2");
      orch.markTaskComplete("task-3");
      orch.markTaskComplete("task-4");

      expect(orch.shouldStop()).toBe(true);
    });

    it("should respect abort signal", async () => {
      const controller = new AbortController();
      const slowExecutor: ClaudeExecutor = {
        execute: vi.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 50));
          return makeClaudeResponse();
        }),
      };
      const orch = createOrchestrator({ executor: slowExecutor });

      // Abort after a short delay
      setTimeout(() => controller.abort(), 10);

      await orch.runLoop(controller.signal);
      // Should have stopped early
      expect(orch.state.iteration).toBeLessThan(3);
    });
  });

  describe("quality gates integration", () => {
    it("should start with no quality report", () => {
      const orch = createOrchestrator();
      expect(orch.qualityReport).toBeUndefined();
    });
  });

  describe("metrics", () => {
    it("should compute elapsed time", async () => {
      const orch = createOrchestrator();
      await new Promise((r) => setTimeout(r, 5));
      await orch.runIteration();

      expect(orch.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it("should track agent log entries", async () => {
      const orch = createOrchestrator();
      await orch.runIteration();

      expect(orch.agentLog.length).toBeGreaterThan(0);
    });
  });
});
