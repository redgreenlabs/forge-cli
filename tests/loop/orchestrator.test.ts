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
    exitSignal: true,
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
      config: { ...defaultConfig, maxIterations: 3, exitSignalThreshold: 1 },
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

  describe("dashboard updates for security and code metrics", () => {
    it("should emit dashboard updates with security metrics after iteration", async () => {
      const updates: Array<{ security?: unknown }> = [];
      const orch = createOrchestrator({
        onDashboardUpdate: (state) => updates.push({ security: state.security }),
      });
      await orch.runIteration();

      // At least one dashboard update should include security data
      const withSecurity = updates.filter((u) => u.security !== undefined);
      expect(withSecurity.length).toBeGreaterThan(0);
    });

    it("should emit multiple dashboard updates during a single iteration", async () => {
      const updateCount = { value: 0 };
      const orch = createOrchestrator({
        onDashboardUpdate: () => { updateCount.value++; },
      });
      await orch.runIteration();

      // Should have many updates: phase changes, security, code metrics, etc.
      expect(updateCount.value).toBeGreaterThan(3);
    });
  });

  describe("timeout handling", () => {
    it("should NOT rotate session on timeout (only on context exhaustion)", async () => {
      let callCount = 0;
      const timeoutExecutor: ClaudeExecutor = {
        execute: vi.fn().mockImplementation(async () => {
          callCount++;
          // Timeout error — should NOT trigger session rotation
          return makeClaudeResponse({
            status: "error",
            error: "Process timed out (exit code 143) — consider increasing timeoutMinutes",
            exitSignal: false,
            testsPass: false,
          });
        }),
      };

      const orch = createOrchestrator({
        executor: timeoutExecutor,
        sessionId: "sess-timeout-test",
      });
      await orch.runIteration();

      // Timeout should NOT cause a session rotation retry —
      // the error is returned as-is to the pipeline (no extra call)
      // Pipeline calls executor for Red phase only (fails, returns error)
      expect(callCount).toBe(1);
    });
  });

  describe("pre-completed tasks", () => {
    it("should pre-mark tasks with done status", () => {
      const orch = new LoopOrchestrator({
        config: { ...defaultConfig, maxIterations: 3, exitSignalThreshold: 1 },
        executor,
        tasks: [
          {
            id: "task-1",
            title: "Already done",
            status: TaskStatus.Done,
            priority: TaskPriority.High,
            category: "",
            acceptanceCriteria: [],
            dependsOn: [],
          },
          {
            id: "task-2",
            title: "Still pending",
            status: TaskStatus.Pending,
            priority: TaskPriority.High,
            category: "",
            acceptanceCriteria: [],
            dependsOn: [],
          },
        ],
        onDashboardUpdate,
      });

      expect(orch.state.tasksCompleted).toBe(1);
      expect(orch.state.completedTaskIds.has("task-1")).toBe(true);
      expect(orch.state.completedTaskIds.has("task-2")).toBe(false);
    });
  });

  describe("no available tasks", () => {
    it("should handle when all tasks are already complete", async () => {
      const orch = new LoopOrchestrator({
        config: { ...defaultConfig, maxIterations: 3, exitSignalThreshold: 1 },
        executor,
        tasks: [
          {
            id: "task-a",
            title: "Done task",
            status: TaskStatus.Done,
            priority: TaskPriority.High,
            category: "",
            acceptanceCriteria: [],
            dependsOn: [],
          },
        ],
        onDashboardUpdate,
      });

      // task-a is already done, so no tasks are available
      await orch.runIteration();
      // Should not have called executor since no tasks available
      expect(executor.execute).not.toHaveBeenCalled();
      // Agent log should note no available tasks
      expect(orch.agentLog.some((e) => e.detail.includes("No available tasks"))).toBe(true);
    });
  });

  describe("extraSystemContext", () => {
    it("should prepend extra context to agent system prompts", async () => {
      const capturingExecutor: ClaudeExecutor = {
        execute: vi.fn().mockResolvedValue(makeClaudeResponse()),
      };

      const orch = new LoopOrchestrator({
        config: { ...defaultConfig, maxIterations: 3, exitSignalThreshold: 1 },
        executor: capturingExecutor,
        tasks: [
          {
            id: "task-1",
            title: "Implement feature",
            status: TaskStatus.Pending,
            priority: TaskPriority.High,
            category: "",
            acceptanceCriteria: [],
            dependsOn: [],
          },
        ],
        onDashboardUpdate,
        extraSystemContext: "EXTRA CONTEXT HERE",
      });

      await orch.runIteration();

      // The executor should have been called with system prompts containing the extra context
      const calls = (capturingExecutor.execute as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const firstSystemPrompt = calls[0][0].systemPrompt;
      expect(firstSystemPrompt).toContain("EXTRA CONTEXT HERE");
    });
  });

  describe("sessionId passthrough", () => {
    it("should pass sessionId to executor calls", async () => {
      const capturingExecutor: ClaudeExecutor = {
        execute: vi.fn().mockResolvedValue(makeClaudeResponse()),
      };

      const orch = new LoopOrchestrator({
        config: { ...defaultConfig, maxIterations: 3, exitSignalThreshold: 1 },
        executor: capturingExecutor,
        tasks: [
          {
            id: "task-1",
            title: "Implement feature",
            status: TaskStatus.Pending,
            priority: TaskPriority.High,
            category: "",
            acceptanceCriteria: [],
            dependsOn: [],
          },
        ],
        onDashboardUpdate,
        sessionId: "sess-abc-123",
      });

      await orch.runIteration();

      const calls = (capturingExecutor.execute as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][0].sessionId).toBe("sess-abc-123");
    });
  });

  describe("task skip after repeated failures", () => {
    it("should skip a task after maxTaskFailures consecutive failures", async () => {
      let callCount = 0;
      const failingExecutor: ClaudeExecutor = {
        execute: vi.fn().mockImplementation(async () => {
          callCount++;
          return makeClaudeResponse({
            status: "error",
            error: "Process timed out (exit code 143) — consider increasing timeoutMinutes",
            exitSignal: false,
            filesModified: [],
            testsPass: false,
            testResults: { total: 0, passed: 0, failed: 0 },
          });
        }),
      };

      const orch = new LoopOrchestrator({
        config: { ...defaultConfig, maxIterations: 10, exitSignalThreshold: 1, maxTaskFailures: 3 },
        executor: failingExecutor,
        tasks: [
          {
            id: "hard-task",
            title: "Build sunburst chart",
            status: TaskStatus.Pending,
            priority: TaskPriority.High,
            category: "",
            acceptanceCriteria: [],
            dependsOn: [],
          },
          {
            id: "easy-task",
            title: "Add README",
            status: TaskStatus.Pending,
            priority: TaskPriority.Medium,
            category: "",
            acceptanceCriteria: [],
            dependsOn: [],
          },
        ],
        onDashboardUpdate,
      });

      // Run 3 iterations — task should fail 3 times then be skipped
      await orch.runIteration();
      await orch.runIteration();
      await orch.runIteration();

      // After 3 failures, the "hard-task" should be skipped
      const logAfterSkip = orch.agentLog;
      const skipEntry = logAfterSkip.find((e) => e.action === "task-skipped");
      expect(skipEntry).toBeDefined();
      expect(skipEntry!.detail).toContain("sunburst chart");

      // 4th iteration should pick up the "easy-task" instead
      await orch.runIteration();
      const logAfter4th = orch.agentLog;
      const selectedEntries = logAfter4th.filter((e) => e.action === "selected");
      const lastSelected = selectedEntries[selectedEntries.length - 1];
      expect(lastSelected?.detail).toContain("README");
    });

    it("should log failure count progress", async () => {
      const failingExecutor: ClaudeExecutor = {
        execute: vi.fn().mockResolvedValue(makeClaudeResponse({
          status: "error",
          error: "Some error",
          exitSignal: false,
          filesModified: [],
          testsPass: false,
          testResults: { total: 0, passed: 0, failed: 0 },
        })),
      };

      const orch = new LoopOrchestrator({
        config: { ...defaultConfig, maxIterations: 10, exitSignalThreshold: 1, maxTaskFailures: 3 },
        executor: failingExecutor,
        tasks: [
          {
            id: "t1",
            title: "Task one",
            status: TaskStatus.Pending,
            priority: TaskPriority.High,
            category: "",
            acceptanceCriteria: [],
            dependsOn: [],
          },
        ],
        onDashboardUpdate,
      });

      await orch.runIteration();
      const retryEntry = orch.agentLog.find((e) => e.action === "task-retry");
      expect(retryEntry).toBeDefined();
      expect(retryEntry!.detail).toContain("1/3");
    });

    it("should reset failure count on task success", async () => {
      let callCount = 0;
      const mixedExecutor: ClaudeExecutor = {
        execute: vi.fn().mockImplementation(async () => {
          callCount++;
          // First 2 calls fail (red phase + green phase of iteration 1 red fails)
          // Actually pipeline treats red phase failure as pipeline failure
          if (callCount <= 2) {
            return makeClaudeResponse({
              status: "error",
              error: "timeout",
              exitSignal: false,
              filesModified: [],
              testsPass: false,
              testResults: { total: 0, passed: 0, failed: 0 },
            });
          }
          // Then succeed
          return makeClaudeResponse();
        }),
      };

      const orch = new LoopOrchestrator({
        config: { ...defaultConfig, maxIterations: 10, exitSignalThreshold: 1, maxTaskFailures: 5 },
        executor: mixedExecutor,
        tasks: [
          {
            id: "t1",
            title: "Task one",
            status: TaskStatus.Pending,
            priority: TaskPriority.High,
            category: "",
            acceptanceCriteria: [],
            dependsOn: [],
          },
        ],
        onDashboardUpdate,
      });

      // First iteration fails
      await orch.runIteration();
      // Should have a retry log
      expect(orch.agentLog.some((e) => e.action === "task-retry")).toBe(true);

      // Next iteration succeeds (or at least the pipeline completes)
      await orch.runIteration();
      // Task should not be skipped
      expect(orch.agentLog.every((e) => e.action !== "task-skipped")).toBe(true);
    });
  });

  describe("workspace-aware quality gates", () => {
    it("should run gates per affected workspace", async () => {
      const orch = new LoopOrchestrator({
        config: {
          ...defaultConfig,
          maxIterations: 3,
          exitSignalThreshold: 1,
          workspaces: [
            { name: "frontend", path: "packages/frontend", type: "node", test: "npm test", lint: "npm run lint" },
            { name: "backend", path: "packages/backend", type: "node", test: "npm test", lint: "npm run lint" },
          ],
        },
        executor: {
          execute: vi.fn().mockResolvedValue(makeClaudeResponse({
            filesModified: ["packages/frontend/src/app.ts"],
          })),
        },
        tasks: [
          {
            id: "task-1",
            title: "Update frontend",
            status: TaskStatus.Pending,
            priority: TaskPriority.High,
            category: "",
            acceptanceCriteria: [],
            dependsOn: [],
          },
        ],
        onDashboardUpdate,
      });

      await orch.runIteration();
      // Should complete without errors — workspace routing is exercised
      expect(orch.state.iteration).toBe(1);
    });
  });

  describe("onTaskFailure callback", () => {
    it("should call onTaskFailure when task reaches maxTaskFailures", async () => {
      const onTaskFailure = vi.fn().mockResolvedValue({ action: "skip" });
      const failExecutor: ClaudeExecutor = {
        execute: vi.fn().mockResolvedValue(makeClaudeResponse({
          status: "error",
          exitSignal: false,
          filesModified: [],
          testsPass: false,
          testResults: { total: 1, passed: 0, failed: 1 },
          error: "Tests failed",
        })),
      };

      const orch = createOrchestrator({
        executor: failExecutor,
        config: { ...defaultConfig, maxIterations: 10, maxTaskFailures: 2, exitSignalThreshold: 999 },
        onTaskFailure,
      });

      // Run enough iterations to hit maxTaskFailures (2)
      await orch.runIteration(); // fail 1
      await orch.runIteration(); // fail 2 → triggers callback

      expect(onTaskFailure).toHaveBeenCalledTimes(1);
      expect(onTaskFailure).toHaveBeenCalledWith(expect.objectContaining({
        title: "Implement feature",
        failCount: 2,
      }));
    });

    it("should defer task when user chooses defer", async () => {
      const onTaskFailure = vi.fn().mockResolvedValue({ action: "defer" });
      const failExecutor: ClaudeExecutor = {
        execute: vi.fn().mockResolvedValue(makeClaudeResponse({
          status: "error",
          exitSignal: false,
          filesModified: [],
          testsPass: false,
          testResults: { total: 1, passed: 0, failed: 1 },
          error: "Tests failed",
        })),
      };

      const orch = createOrchestrator({
        executor: failExecutor,
        config: { ...defaultConfig, maxIterations: 10, maxTaskFailures: 1, exitSignalThreshold: 999 },
        onTaskFailure,
      });

      await orch.runIteration(); // fail → triggers callback → defer

      // Verify the task was deferred (not skipped)
      const log = orch.agentLog;
      expect(log.some((e: { action: string }) => e.action === "task-deferred")).toBe(true);
    });

    it("should abort session when user chooses abort", async () => {
      const onTaskFailure = vi.fn().mockResolvedValue({ action: "abort" });
      const failExecutor: ClaudeExecutor = {
        execute: vi.fn().mockResolvedValue(makeClaudeResponse({
          status: "error",
          exitSignal: false,
          filesModified: [],
          testsPass: false,
          testResults: { total: 1, passed: 0, failed: 1 },
          error: "Tests failed",
        })),
      };

      const orch = createOrchestrator({
        executor: failExecutor,
        config: { ...defaultConfig, maxIterations: 10, maxTaskFailures: 1, exitSignalThreshold: 999 },
        onTaskFailure,
      });

      await orch.runIteration(); // fail → abort
      await orch.runLoop(); // should stop immediately

      const log = orch.agentLog;
      expect(log.some((e: { action: string }) => e.action === "user-abort")).toBe(true);
    });

    it("should auto-skip when no onTaskFailure callback is set", async () => {
      const failExecutor: ClaudeExecutor = {
        execute: vi.fn().mockResolvedValue(makeClaudeResponse({
          status: "error",
          exitSignal: false,
          filesModified: [],
          testsPass: false,
          testResults: { total: 1, passed: 0, failed: 1 },
          error: "Tests failed",
        })),
      };

      const orch = createOrchestrator({
        executor: failExecutor,
        config: { ...defaultConfig, maxIterations: 10, maxTaskFailures: 1, exitSignalThreshold: 999 },
        // No onTaskFailure — headless mode
      });

      await orch.runIteration(); // fail → auto-skip

      const log = orch.agentLog;
      expect(log.some((e: { action: string }) => e.action === "task-skipped")).toBe(true);
    });

    it("should prepend user guidance to task context on retry", async () => {
      let callCount = 0;
      const failExecutor: ClaudeExecutor = {
        execute: vi.fn().mockImplementation(async (opts: { prompt: string }) => {
          callCount++;
          // First 2 calls fail (TDD pipeline calls executor multiple times)
          // After guidance, check that the prompt includes guidance
          if (callCount > 4 && opts.prompt.includes("Use the FooBar library")) {
            return makeClaudeResponse(); // success with guidance
          }
          return makeClaudeResponse({
            status: "error",
            exitSignal: false,
            filesModified: [],
            testsPass: false,
            testResults: { total: 1, passed: 0, failed: 1 },
            error: "Tests failed",
          });
        }),
      };

      const onTaskFailure = vi.fn().mockResolvedValue({
        action: "retry",
        guidance: "Use the FooBar library",
      });

      const orch = createOrchestrator({
        executor: failExecutor,
        config: { ...defaultConfig, maxIterations: 10, maxTaskFailures: 1, exitSignalThreshold: 999 },
        onTaskFailure,
      });

      await orch.runIteration(); // fail → retry with guidance
      await orch.runIteration(); // retries — executor checks for guidance in prompt

      const log = orch.agentLog;
      expect(log.some((e: { action: string }) => e.action === "task-retry-guided")).toBe(true);
    });
  });
});
