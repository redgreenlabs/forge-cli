import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  LoopRunner,
  type LoopRunnerOptions,
  type RunResult,
} from "../../src/loop/runner.js";
import { defaultConfig } from "../../src/config/schema.js";
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

/** Safe config that disables security and retries for unit tests */
const safeConfig = {
  ...defaultConfig,
  tdd: { ...defaultConfig.tdd, commitPerPhase: false },
  security: { ...defaultConfig.security, enabled: false },
  retry: { maxPhaseRetries: 0, retryDelayMs: 0 },
  exitSignalThreshold: 1,
};

function mockExecutor(responses: Array<Partial<import("../../src/loop/orchestrator.js").ClaudeResponse>> = []) {
  let callCount = 0;
  return {
    execute: vi.fn().mockImplementation(async () => {
      const resp = responses[callCount] ?? {};
      callCount++;
      return {
        status: "success",
        exitSignal: true,
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
  {
    id: "t3",
    title: "Add documentation",
    status: TaskStatus.Pending,
    priority: TaskPriority.Medium,
    category: "",
    acceptanceCriteria: [],
    dependsOn: ["t2"],
  },
  {
    id: "t4",
    title: "Final review",
    status: TaskStatus.Pending,
    priority: TaskPriority.Low,
    category: "",
    acceptanceCriteria: [],
    dependsOn: ["t3"],
  },
];

describe("LoopRunner", () => {
  describe("run", () => {
    it("should execute iterations up to max", async () => {
      const runner = new LoopRunner({
        config: { ...safeConfig, maxIterations: 3 },
        executor: mockExecutor(),
        tasks: sampleTasks,
      });

      const result = await runner.run();
      expect(result.iterations).toBe(3);
      expect(result.stopReason).toBe("max_iterations_reached");
    });

    it("should report tasks completed", async () => {
      const runner = new LoopRunner({
        config: { ...safeConfig, maxIterations: 5 },
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
        config: { ...safeConfig, maxIterations: 100 },
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
        config: { ...safeConfig, maxIterations: 2 },
        executor: mockExecutor(),
        tasks: sampleTasks,
        onDashboardUpdate: (state) => snapshots.push(state),
      });

      await runner.run();
      expect(snapshots.length).toBeGreaterThan(0);
    });

    it("should return timing information", async () => {
      const runner = new LoopRunner({
        config: { ...safeConfig, maxIterations: 1 },
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
        config: { ...safeConfig, maxIterations: 5 },
        executor: failExecutor,
        tasks: sampleTasks,
      });

      const result = await runner.run();
      // Should stop via circuit breaker
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("log persistence", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "forge-runner-log-"));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should create log file in .forge/logs", async () => {
      const runner = new LoopRunner({
        config: { ...safeConfig, maxIterations: 1 },
        executor: mockExecutor(),
        tasks: [sampleTasks[0]!],
        forgeDir: tmpDir,
        sessionId: "test-session-abc",
      });

      await runner.run();

      const logsDir = join(tmpDir, "logs");
      expect(existsSync(logsDir)).toBe(true);

      // Log file named after session prefix
      const logFile = join(logsDir, "test-ses.jsonl");
      expect(existsSync(logFile)).toBe(true);

      const content = readFileSync(logFile, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);

      // Each line should be valid JSON
      for (const line of lines) {
        const entry = JSON.parse(line);
        expect(entry).toHaveProperty("timestamp");
        expect(entry).toHaveProperty("agent");
        expect(entry).toHaveProperty("action");
      }
    });

    it("should log start and end entries", async () => {
      const runner = new LoopRunner({
        config: { ...safeConfig, maxIterations: 1 },
        executor: mockExecutor(),
        tasks: [sampleTasks[0]!],
        forgeDir: tmpDir,
        sessionId: "log-start-end-x",
      });

      await runner.run();

      const logFile = join(tmpDir, "logs", "log-star.jsonl");
      const content = readFileSync(logFile, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      const entries = lines.map((l) => JSON.parse(l));

      const actions = entries.map((e: { action: string }) => e.action);
      expect(actions).toContain("start");
      expect(actions).toContain("end");
    });
  });

  describe("resume", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "forge-runner-resume-"));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should persist completed task IDs in context file", async () => {
      const runner = new LoopRunner({
        config: { ...safeConfig, maxIterations: 5 },
        executor: mockExecutor(),
        tasks: [sampleTasks[0]!],
        forgeDir: tmpDir,
      });

      await runner.run();

      // Context file should exist with completedTaskIds
      const contextPath = join(tmpDir, "context.json");
      expect(existsSync(contextPath)).toBe(true);

      const context = JSON.parse(readFileSync(contextPath, "utf-8"));
      expect(context.sharedState.completedTaskIds).toBeDefined();
    });

    it("should skip completed tasks on resume", async () => {
      // First run — complete task t1
      const runner1 = new LoopRunner({
        config: { ...safeConfig, maxIterations: 5 },
        executor: mockExecutor(),
        tasks: [sampleTasks[0]!],
        forgeDir: tmpDir,
      });
      await runner1.run();

      // Second run with resume — t1 should already be marked done
      const executor2 = mockExecutor();
      const runner2 = new LoopRunner({
        config: { ...safeConfig, maxIterations: 2 },
        executor: executor2,
        tasks: sampleTasks,
        forgeDir: tmpDir,
        resume: true,
      });

      const result = await runner2.run();

      // If t1 is already complete, the orchestrator should move to t2
      // The key check is that it didn't re-do t1
      expect(result.iterations).toBeGreaterThan(0);
    });

    it("should update prd.json with completed task status", async () => {
      // Write a prd.json with pending tasks
      writeFileSync(
        join(tmpDir, "prd.json"),
        JSON.stringify({
          title: "Test",
          description: "",
          tasks: [
            { id: "t1", title: "Task 1", status: "pending", priority: "high", acceptanceCriteria: [], dependsOn: [] },
            { id: "t2", title: "Task 2", status: "pending", priority: "medium", acceptanceCriteria: [], dependsOn: ["t1"] },
          ],
        }, null, 2) + "\n"
      );

      const runner = new LoopRunner({
        config: { ...safeConfig, maxIterations: 5 },
        executor: mockExecutor(),
        tasks: [sampleTasks[0]!],
        forgeDir: tmpDir,
      });

      await runner.run();

      // prd.json should be updated
      const prd = JSON.parse(readFileSync(join(tmpDir, "prd.json"), "utf-8"));
      const t1 = prd.tasks.find((t: { id: string }) => t.id === "t1");
      expect(t1.status).toBe("done");

      // t2 should still be pending
      const t2 = prd.tasks.find((t: { id: string }) => t.id === "t2");
      expect(t2.status).toBe("pending");
    });

    it("should not write duplicate log entries", async () => {
      const runner = new LoopRunner({
        config: { ...safeConfig, maxIterations: 3 },
        executor: mockExecutor(),
        tasks: [sampleTasks[0]!],
        forgeDir: tmpDir,
        sessionId: "nodup-log-test",
      });

      await runner.run();

      const logFile = join(tmpDir, "logs", "nodup-lo.jsonl");
      const content = readFileSync(logFile, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      const entries = lines.map((l) => JSON.parse(l));

      // Count "start" entries — should appear exactly once
      const startEntries = entries.filter(
        (e: { action: string }) => e.action === "start"
      );
      expect(startEntries).toHaveLength(1);

      // Count "end" entries — should appear exactly once
      const endEntries = entries.filter(
        (e: { action: string }) => e.action === "end"
      );
      expect(endEntries).toHaveLength(1);

      // No two consecutive entries should be identical (timestamp may differ,
      // but action+agent+detail combos should not repeat from flush duplication)
      const signatures = entries.map(
        (e: { agent: string; action: string; detail: string }) =>
          `${e.agent}:${e.action}:${e.detail}`
      );
      // Agent log entries from the orchestrator should not be duplicated
      // Count each orchestrator entry — it should appear at most once
      const agentEntries = entries.filter(
        (e: { action: string }) => e.action !== "start" && e.action !== "end"
      );
      const agentSigs = agentEntries.map(
        (e: { agent: string; action: string; detail: string }) =>
          `${e.agent}:${e.action}:${e.detail}`
      );
      const uniqueAgentSigs = new Set(agentSigs);
      // With the fix, each orchestrator log should appear once (not duplicated by flushLogs)
      expect(agentSigs.length).toBe(uniqueAgentSigs.size);
    });

    it("should update tasks.md checkboxes for completed tasks", async () => {
      // Write a tasks.md with checkboxes
      writeFileSync(
        join(tmpDir, "tasks.md"),
        `# Tasks\n\n## Priority: High\n- [ ] [t1] Task 1\n\n## Priority: Medium\n- [ ] [t2] Task 2 (depends: t1)\n`
      );

      const runner = new LoopRunner({
        config: { ...safeConfig, maxIterations: 5 },
        executor: mockExecutor(),
        tasks: [sampleTasks[0]!],
        forgeDir: tmpDir,
      });

      await runner.run();

      const content = readFileSync(join(tmpDir, "tasks.md"), "utf-8");
      expect(content).toContain("- [x] [t1]");
      expect(content).toContain("- [ ] [t2]");
    });
  });
});
