import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LoopRunner,
  type LoopRunnerOptions,
  type RunResult,
} from "../../src/loop/runner.js";
import { defaultConfig } from "../../src/config/schema.js";
import { TaskStatus, TaskPriority } from "../../src/prd/parser.js";

function mockExecutor(responses: Array<Partial<import("../../src/loop/orchestrator.js").ClaudeResponse>> = []) {
  let callCount = 0;
  return {
    execute: vi.fn().mockImplementation(async () => {
      const resp = responses[callCount] ?? {};
      callCount++;
      return {
        status: "success",
        exitSignal: false,
        filesModified: ["file.ts"],
        testsPass: true,
        testResults: { total: 1, passed: 1, failed: 0 },
        error: null,
        ...resp,
      };
    }),
  };
}

const sampleTasks = [
  {
    id: "t1",
    title: "Implement feature",
    status: TaskStatus.Pending,
    priority: TaskPriority.High,
    category: "",
    acceptanceCriteria: [],
    dependsOn: [],
  },
  {
    id: "t2",
    title: "Write tests",
    status: TaskStatus.Pending,
    priority: TaskPriority.High,
    category: "",
    acceptanceCriteria: [],
    dependsOn: ["t1"],
  },
];

describe("LoopRunner", () => {
  describe("run", () => {
    it("should execute iterations up to max", async () => {
      const runner = new LoopRunner({
        config: { ...defaultConfig, maxIterations: 3 },
        executor: mockExecutor(),
        tasks: sampleTasks,
      });

      const result = await runner.run();
      expect(result.iterations).toBe(3);
      expect(result.stopReason).toBe("max_iterations_reached");
    });

    it("should report tasks completed", async () => {
      const runner = new LoopRunner({
        config: { ...defaultConfig, maxIterations: 5 },
        executor: mockExecutor([
          { exitSignal: false },
          { exitSignal: true },
        ]),
        tasks: [sampleTasks[0]!],
      });

      const result = await runner.run();
      expect(result.iterations).toBeGreaterThan(0);
    });

    it("should stop on abort signal", async () => {
      const controller = new AbortController();
      const slowExecutor = {
        execute: vi.fn().mockImplementation(async () => {
          await new Promise((r) => setTimeout(r, 50));
          return {
            status: "success",
            exitSignal: false,
            filesModified: ["f.ts"],
            testsPass: true,
            testResults: { total: 1, passed: 1, failed: 0 },
            error: null,
          };
        }),
      };

      const runner = new LoopRunner({
        config: { ...defaultConfig, maxIterations: 100 },
        executor: slowExecutor,
        tasks: sampleTasks,
      });

      setTimeout(() => controller.abort(), 30);
      const result = await runner.run(controller.signal);
      expect(result.stopReason).toBe("aborted");
      expect(result.iterations).toBeLessThan(100);
    });

    it("should collect dashboard snapshots", async () => {
      const snapshots: unknown[] = [];
      const runner = new LoopRunner({
        config: { ...defaultConfig, maxIterations: 2 },
        executor: mockExecutor(),
        tasks: sampleTasks,
        onDashboardUpdate: (state) => snapshots.push(state),
      });

      await runner.run();
      expect(snapshots.length).toBeGreaterThan(0);
    });

    it("should return timing information", async () => {
      const runner = new LoopRunner({
        config: { ...defaultConfig, maxIterations: 1 },
        executor: mockExecutor(),
        tasks: sampleTasks,
      });

      const result = await runner.run();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.startedAt).toBeLessThanOrEqual(Date.now());
    });

    it("should handle executor errors without crashing", async () => {
      const failExecutor = {
        execute: vi.fn().mockRejectedValue(new Error("Claude crashed")),
      };
      const runner = new LoopRunner({
        config: { ...defaultConfig, maxIterations: 5 },
        executor: failExecutor,
        tasks: sampleTasks,
      });

      const result = await runner.run();
      // Should stop via circuit breaker
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
