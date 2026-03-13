/**
 * Full pipeline integration test.
 *
 * Creates a real git repo, initializes Forge, imports a PRD,
 * and runs the loop with a mock executor that returns realistic
 * Claude Code JSON responses (tool_use entries, test output, etc.).
 *
 * Validates: task selection → agent assignment → TDD phases →
 * security scan → quality gates → git commits → resume → logs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { initProject } from "../../src/commands/init.js";
import { importPrd } from "../../src/commands/import.js";
import { prepareRunContext } from "../../src/commands/run.js";
import { LoopRunner } from "../../src/loop/runner.js";
import { defaultConfig, type ForgeConfig } from "../../src/config/schema.js";
import type { ClaudeExecutor, ClaudeResponse, DashboardState } from "../../src/loop/orchestrator.js";

// Mock modules that spawn child processes (quality gates run `npm test`, `npm run lint`, etc.)
vi.mock("../../src/loop/phase-impl.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../src/loop/phase-impl.js")>();
  return {
    ...orig,
    runQualityGates: vi.fn().mockResolvedValue({
      passed: true,
      results: [],
      summary: { total: 0, passed: 0, failed: 0, warnings: 0, errors: 0 },
      totalDurationMs: 0,
    }),
  };
});
vi.mock("../../src/gates/plugin.js", () => ({
  GatePluginRegistry: class MockRegistry {
    register() {}
    toGateDefinitions() { return []; }
  },
  createBuiltinGates: vi.fn().mockReturnValue([]),
}));

/** Build a realistic Claude JSON response with tool_use entries */
function buildClaudeResponse(opts: {
  files?: Array<{ path: string; content: string }>;
  testOutput?: string;
  testsPass?: boolean;
  exitSignal?: boolean;
}): ClaudeResponse {
  const filesModified = (opts.files ?? []).map((f) => f.path);

  return {
    status: "success",
    exitSignal: opts.exitSignal ?? false,
    filesModified,
    testsPass: opts.testsPass ?? true,
    testResults: opts.testsPass === false
      ? { total: 3, passed: 1, failed: 2 }
      : { total: 3, passed: 3, failed: 0 },
    error: null,
  };
}

/** Create a mock executor that returns canned responses per call */
function createMockExecutor(
  projectRoot: string
): { executor: ClaudeExecutor; calls: Array<{ prompt: string; systemPrompt: string }> } {
  const calls: Array<{ prompt: string; systemPrompt: string }> = [];
  let callCount = 0;

  const executor: ClaudeExecutor = {
    execute: async (options) => {
      calls.push({ prompt: options.prompt, systemPrompt: options.systemPrompt });
      callCount++;

      const isRed = options.prompt.includes("[TDD RED PHASE]");
      const isGreen = options.prompt.includes("[TDD GREEN PHASE]");
      const isRefactor = options.prompt.includes("[TDD REFACTOR PHASE]");

      if (isRed) {
        // Write a test file
        const testPath = join(projectRoot, "src", "__tests__", `feature-${callCount}.test.ts`);
        mkdirSync(join(projectRoot, "src", "__tests__"), { recursive: true });
        writeFileSync(testPath, `// Test for call ${callCount}\nimport { expect, test } from "vitest";\ntest("feature", () => { expect(true).toBe(true); });\n`);
        return buildClaudeResponse({
          files: [{ path: testPath, content: "test" }],
          testsPass: false, // Red phase: test should fail
        });
      }

      if (isGreen) {
        // Write implementation
        const implPath = join(projectRoot, "src", `feature-${callCount}.ts`);
        mkdirSync(join(projectRoot, "src"), { recursive: true });
        writeFileSync(implPath, `// Implementation for call ${callCount}\nexport function feature() { return true; }\n`);
        return buildClaudeResponse({
          files: [{ path: implPath, content: "impl" }],
          testsPass: true, // Green phase: tests pass
        });
      }

      if (isRefactor) {
        return buildClaudeResponse({
          files: [],
          testsPass: true,
        });
      }

      // Default response
      return buildClaudeResponse({ testsPass: true });
    },
  };

  return { executor, calls };
}

/** Initialize a temp directory as a git repo with Forge */
async function setupTestProject(tmpDir: string) {
  // Init git repo
  execSync("git init", { cwd: tmpDir, stdio: "pipe" });
  execSync("git config user.email 'test@test.com'", { cwd: tmpDir, stdio: "pipe" });
  execSync("git config user.name 'Test'", { cwd: tmpDir, stdio: "pipe" });

  // Create a base file and initial commit
  writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test-project", version: "1.0.0" }, null, 2));
  mkdirSync(join(tmpDir, "src"), { recursive: true });
  writeFileSync(join(tmpDir, "src", "index.ts"), "export const hello = 'world';\n");
  execSync("git add -A && git commit -m 'initial commit'", { cwd: tmpDir, stdio: "pipe" });

  // Init Forge
  const initResult = await initProject(tmpDir, { projectName: "test-project" });
  if (!initResult.success) throw new Error(`Init failed: ${initResult.error}`);

  // Import a small PRD
  const prdPath = join(tmpDir, "prd.md");
  writeFileSync(prdPath, `# Test Project PRD

## Features

- [ ] [task-1] Add greeting function [HIGH]
  - Should accept a name parameter
  - Should return a formatted greeting
- [ ] [task-2] Add farewell function [MEDIUM] (depends: task-1)
  - Should accept a name parameter
  - Should return a formatted farewell
`);
  const importResult = importPrd(prdPath, tmpDir);
  if (!importResult.success) throw new Error(`Import failed: ${importResult.error}`);

  // Commit forge setup
  execSync("git add -A && git commit -m 'chore: init forge project'", { cwd: tmpDir, stdio: "pipe" });

  return { initResult, importResult };
}

describe("Full Pipeline Integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-full-pipeline-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should run init → import → run with mock executor", async () => {
    await setupTestProject(tmpDir);

    const runCtx = prepareRunContext(tmpDir);
    expect(runCtx.tasks.length).toBe(2);

    const { executor, calls } = createMockExecutor(tmpDir);

    const config: ForgeConfig = {
      ...defaultConfig,
      maxIterations: 3,
      retry: { maxPhaseRetries: 0, retryDelayMs: 0 },
    };

    const dashboards: DashboardState[] = [];
    const runner = new LoopRunner({
      config,
      executor,
      tasks: runCtx.tasks,
      projectRoot: tmpDir,
      forgeDir: join(tmpDir, ".forge"),
      onDashboardUpdate: (state) => dashboards.push({ ...state }),
    });

    const result = await runner.run();

    // Should have run iterations
    expect(result.iterations).toBeGreaterThan(0);
    expect(result.iterations).toBeLessThanOrEqual(3);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Should have called executor (Red + Green + Refactor per iteration)
    expect(calls.length).toBeGreaterThan(0);

    // Calls should include TDD phase prompts
    const prompts = calls.map((c) => c.prompt);
    expect(prompts.some((p) => p.includes("[TDD RED PHASE]"))).toBe(true);
    expect(prompts.some((p) => p.includes("[TDD GREEN PHASE]"))).toBe(true);

    // Dashboard should have been updated
    expect(dashboards.length).toBeGreaterThan(0);

    // Dashboard should show task info
    const lastDash = dashboards[dashboards.length - 1]!;
    expect(lastDash.loop.totalTasks).toBe(2);
  });

  it("should create git commits during TDD phases", async () => {
    await setupTestProject(tmpDir);
    const runCtx = prepareRunContext(tmpDir);
    const { executor } = createMockExecutor(tmpDir);

    const config: ForgeConfig = {
      ...defaultConfig,
      maxIterations: 1,
      retry: { maxPhaseRetries: 0, retryDelayMs: 0 },
    };

    const runner = new LoopRunner({
      config,
      executor,
      tasks: runCtx.tasks,
      projectRoot: tmpDir,
      forgeDir: join(tmpDir, ".forge"),
    });

    const beforeCommits = execSync("git log --oneline", { cwd: tmpDir, encoding: "utf-8" }).trim().split("\n").length;
    await runner.run();
    const afterCommits = execSync("git log --oneline", { cwd: tmpDir, encoding: "utf-8" }).trim().split("\n").length;

    // Should have created at least one commit (Red/Green/Refactor)
    expect(afterCommits).toBeGreaterThan(beforeCommits);
  });

  it("should persist logs to .forge/logs/", async () => {
    await setupTestProject(tmpDir);
    const runCtx = prepareRunContext(tmpDir);
    const { executor } = createMockExecutor(tmpDir);

    const runner = new LoopRunner({
      config: { ...defaultConfig, maxIterations: 1, retry: { maxPhaseRetries: 0, retryDelayMs: 0 } },
      executor,
      tasks: runCtx.tasks,
      projectRoot: tmpDir,
      forgeDir: join(tmpDir, ".forge"),
      sessionId: "integ-test-session",
    });

    await runner.run();

    const logsDir = join(tmpDir, ".forge", "logs");
    expect(existsSync(logsDir)).toBe(true);

    const logFile = join(logsDir, "integ-te.jsonl");
    expect(existsSync(logFile)).toBe(true);

    const lines = readFileSync(logFile, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(2); // At least start + agent activity + end

    // Verify JSON structure
    const first = JSON.parse(lines[0]!);
    expect(first.agent).toBe("system");
    expect(first.action).toBe("start");
  });

  it("should persist context and support resume", async () => {
    await setupTestProject(tmpDir);
    const runCtx = prepareRunContext(tmpDir);
    const { executor } = createMockExecutor(tmpDir);

    // First run — 1 iteration, should complete task-1 only
    const runner1 = new LoopRunner({
      config: { ...defaultConfig, maxIterations: 1, retry: { maxPhaseRetries: 0, retryDelayMs: 0 } },
      executor,
      tasks: runCtx.tasks,
      projectRoot: tmpDir,
      forgeDir: join(tmpDir, ".forge"),
    });

    const result1 = await runner1.run();
    expect(result1.iterations).toBe(1);

    // Context file should exist
    const contextPath = join(tmpDir, ".forge", "context.json");
    expect(existsSync(contextPath)).toBe(true);

    const context = JSON.parse(readFileSync(contextPath, "utf-8"));
    expect(context.sharedState.completedTaskIds).toBeDefined();
    expect(context.sharedState.lastIteration).toBeGreaterThan(0);

    // Second run with resume
    const { executor: executor2 } = createMockExecutor(tmpDir);
    const runner2 = new LoopRunner({
      config: { ...defaultConfig, maxIterations: 2, retry: { maxPhaseRetries: 0, retryDelayMs: 0 } },
      executor: executor2,
      tasks: runCtx.tasks,
      projectRoot: tmpDir,
      forgeDir: join(tmpDir, ".forge"),
      resume: true,
    });

    const result2 = await runner2.run();
    // Should continue from where run1 left off
    expect(result2.iterations).toBeGreaterThan(0);
  });

  it("should handle executor errors gracefully", async () => {
    await setupTestProject(tmpDir);
    const runCtx = prepareRunContext(tmpDir);

    let callCount = 0;
    const failingExecutor: ClaudeExecutor = {
      execute: async () => {
        callCount++;
        if (callCount <= 2) {
          throw new Error("Connection refused");
        }
        return buildClaudeResponse({ testsPass: true });
      },
    };

    const runner = new LoopRunner({
      config: {
        ...defaultConfig,
        maxIterations: 5,
        retry: { maxPhaseRetries: 0, retryDelayMs: 0 },
        circuitBreaker: { ...defaultConfig.circuitBreaker, sameErrorThreshold: 2 },
      },
      executor: failingExecutor,
      tasks: runCtx.tasks,
      projectRoot: tmpDir,
      forgeDir: join(tmpDir, ".forge"),
    });

    const result = await runner.run();

    // Should not crash, circuit breaker should trip after 2 same errors
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.stopReason).toBe("circuit_breaker_open");
  });

  it("should show current task in dashboard updates", async () => {
    await setupTestProject(tmpDir);
    const runCtx = prepareRunContext(tmpDir);
    const { executor } = createMockExecutor(tmpDir);

    const dashboards: DashboardState[] = [];
    const runner = new LoopRunner({
      config: { ...defaultConfig, maxIterations: 1, retry: { maxPhaseRetries: 0, retryDelayMs: 0 } },
      executor,
      tasks: runCtx.tasks,
      projectRoot: tmpDir,
      forgeDir: join(tmpDir, ".forge"),
      onDashboardUpdate: (state) => dashboards.push({ ...state }),
    });

    await runner.run();

    // At least one dashboard update should have the current task name
    const withTask = dashboards.filter((d) => d.currentTask);
    expect(withTask.length).toBeGreaterThan(0);
    expect(withTask[0]!.currentTask).toContain("greeting");
  });

  it("should respect task dependencies (task-2 depends on task-1)", async () => {
    await setupTestProject(tmpDir);
    const runCtx = prepareRunContext(tmpDir);
    const { executor, calls } = createMockExecutor(tmpDir);

    const dashboards: DashboardState[] = [];
    const runner = new LoopRunner({
      config: { ...defaultConfig, maxIterations: 2, retry: { maxPhaseRetries: 0, retryDelayMs: 0 } },
      executor,
      tasks: runCtx.tasks,
      projectRoot: tmpDir,
      forgeDir: join(tmpDir, ".forge"),
      onDashboardUpdate: (state) => dashboards.push({ ...state }),
    });

    await runner.run();

    // First iteration's prompts should reference task-1 (greeting), not task-2 (farewell)
    const firstRedCall = calls.find((c) => c.prompt.includes("[TDD RED PHASE]"));
    expect(firstRedCall).toBeDefined();
    expect(firstRedCall!.prompt.toLowerCase()).toContain("greeting");
  });
});
