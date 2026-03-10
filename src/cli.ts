import { Command } from "commander";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import chalk from "chalk";
import { initProject } from "./commands/init.js";
import { importPrd } from "./commands/import.js";
import { loadConfig } from "./config/loader.js";
import { AgentRole } from "./config/schema.js";
import { getAgentDefinition } from "./agents/roles.js";
import { SessionManager } from "./loop/session.js";
import { renderDashboard } from "./tui/renderer.js";
import { LoopEngine, LoopPhase, type LoopEventHandler } from "./loop/engine.js";
import { TddPhase } from "./tdd/enforcer.js";

const pkg = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../package.json"), "utf-8")
) as { version: string };

const program = new Command();

program
  .name("forge")
  .description(
    "Autonomous multi-agent development orchestrator with TDD, security, and craftsmanship"
  )
  .version(pkg.version);

program
  .command("init")
  .description("Initialize a new Forge project in the current directory")
  .option("-i, --interactive", "Guide through PRD creation interactively")
  .option("-n, --name <name>", "Project name")
  .option("-f, --force", "Overwrite existing .forge directory")
  .action(async (options) => {
    const cwd = process.cwd();
    console.log(chalk.cyan("Initializing Forge project..."));

    const result = await initProject(cwd, {
      projectName: options.name as string | undefined,
      force: options.force as boolean | undefined,
    });

    if (!result.success) {
      console.error(chalk.red(`Error: ${result.error}`));
      process.exit(1);
    }

    console.log(chalk.green("Forge project initialized successfully!"));
    console.log(`  Project type: ${chalk.bold(result.projectType)}`);
    console.log(`  Created files:`);
    for (const file of result.createdFiles) {
      console.log(`    ${chalk.gray("+")} .forge/${file}`);
    }
    console.log(
      `\nNext: ${chalk.cyan("forge import <prd-file>")} or ${chalk.cyan("forge run")}`
    );
  });

program
  .command("run")
  .description("Start the autonomous development loop")
  .option(
    "-n, --iterations <number>",
    "Maximum iterations",
    (v) => parseInt(v, 10),
    50
  )
  .option("--no-tui", "Disable TUI dashboard (plain text output)")
  .option("--solo", "Run in solo mode (single agent)")
  .option("--dry-run", "Simulate execution without running Claude")
  .action(async (options) => {
    const cwd = process.cwd();
    const { config, errors } = loadConfig(cwd);

    if (errors.length > 0) {
      for (const err of errors) {
        console.warn(chalk.yellow(`Config warning: ${err}`));
      }
    }

    const effectiveConfig = {
      ...config,
      maxIterations: options.iterations as number,
    };

    // Session management
    const session = new SessionManager(resolve(cwd, ".forge"));
    session.load();
    if (session.isActive && !session.isExpired) {
      console.log(
        chalk.cyan(`Resuming session ${session.sessionId.slice(0, 8)}...`)
      );
    } else {
      session.create();
      console.log(
        chalk.cyan(`New session ${session.sessionId.slice(0, 8)}...`)
      );
    }

    if (options.dryRun) {
      console.log(chalk.yellow("\n[DRY RUN] Configuration:"));
      console.log(`  Max iterations: ${effectiveConfig.maxIterations}`);
      console.log(`  TDD enabled: ${effectiveConfig.tdd.enabled}`);
      console.log(`  Security enabled: ${effectiveConfig.security.enabled}`);
      console.log(`  Agent team: ${effectiveConfig.agents.team.join(", ")}`);

      // Show a sample dashboard
      const sampleHandler: LoopEventHandler = {
        onIterationStart: () => {},
        onIterationEnd: () => {},
        onPhaseChange: () => {},
        onQualityGateResult: () => {},
        onError: () => {},
        onComplete: () => {},
      };
      const engine = new LoopEngine(effectiveConfig, sampleHandler);
      engine.setTotalTasks(5);
      engine.incrementIteration();
      engine.setPhase(LoopPhase.Testing);
      engine.recordTaskCompleted("sample-1");

      console.log("\n" + renderDashboard({
        state: engine.state,
        tddPhase: TddPhase.Red,
        tddCycles: 0,
        coverage: { lines: 85, branches: 72, functions: 90, trend: "stable" },
        security: { critical: 0, high: 0, medium: 1, low: 2 },
        agentLog: [
          {
            timestamp: Date.now(),
            agent: "architect",
            action: "planning",
            detail: "Analyzing task dependencies",
          },
          {
            timestamp: Date.now(),
            agent: "tester",
            action: "writing",
            detail: "Creating test for auth module",
          },
        ],
      }));

      console.log(chalk.yellow("\n[DRY RUN] Would start loop execution."));
      return;
    }

    console.log(
      chalk.bold.cyan(
        `\nStarting Forge loop (max ${effectiveConfig.maxIterations} iterations)...`
      )
    );
    console.log(
      chalk.gray("  Press Ctrl+C to stop gracefully.\n")
    );

    // Load tasks
    const { prepareRunContext } = await import("./commands/run.js");
    const runCtx = prepareRunContext(cwd);

    if (runCtx.tasks.length === 0) {
      console.log(
        chalk.yellow("No tasks found. Run `forge import <prd>` first.")
      );
      return;
    }

    console.log(
      chalk.gray(`  Loaded ${runCtx.tasks.length} tasks from PRD.`)
    );

    // Create executor
    const { ClaudeCodeExecutor } = await import("./loop/executor.js");
    const executor = new ClaudeCodeExecutor();

    // Create runner
    const { LoopRunner } = await import("./loop/runner.js");
    const runner = new LoopRunner({
      config: effectiveConfig,
      executor,
      tasks: runCtx.tasks,
      onDashboardUpdate: (dashState) => {
        if (options.tui !== false) {
          // Clear and re-render terminal dashboard
          process.stdout.write("\x1B[2J\x1B[H");
          console.log(renderDashboard({
            state: dashState.loop,
            tddPhase: dashState.tddPhase,
            tddCycles: dashState.tddCycles,
            agentLog: dashState.agentLog,
            qualityGates: dashState.qualityReport,
          }));
        }
      },
    });

    // Handle graceful shutdown
    const controller = new AbortController();
    const onSignal = () => {
      console.log(chalk.yellow("\n\nGraceful shutdown..."));
      controller.abort();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    try {
      const result = await runner.run(controller.signal);

      // Update session
      session.recordIteration(result.iterations);
      if (result.stopReason === "all_tasks_complete") {
        session.complete(result.stopReason);
      }
      session.save();

      // Print summary
      console.log(chalk.bold.cyan("\n\nForge Run Complete"));
      console.log(chalk.gray("─".repeat(40)));
      console.log(`  Iterations: ${result.iterations}`);
      console.log(
        `  Tasks:      ${result.tasksCompleted}/${result.totalTasks} completed`
      );
      console.log(`  Duration:   ${(result.durationMs / 1000).toFixed(1)}s`);
      console.log(`  Stop:       ${result.stopReason}`);
      if (result.errors.length > 0) {
        console.log(chalk.red(`  Errors:     ${result.errors.length}`));
        for (const err of result.errors) {
          console.log(chalk.red(`    - ${err}`));
        }
      }
    } finally {
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
    }
  });

program
  .command("import <file>")
  .description("Import a PRD from a file (Markdown, JSON, or text)")
  .action(async (file: string) => {
    const cwd = process.cwd();
    console.log(chalk.cyan(`Importing PRD from ${file}...`));

    const result = importPrd(resolve(cwd, file), cwd);

    if (!result.success) {
      console.error(chalk.red(`Error: ${result.error}`));
      process.exit(1);
    }

    console.log(chalk.green(`Imported ${result.tasksImported} tasks:`));
    const { priorities } = result;
    if (priorities.critical > 0)
      console.log(chalk.red(`  Critical: ${priorities.critical}`));
    if (priorities.high > 0)
      console.log(chalk.yellow(`  High:     ${priorities.high}`));
    if (priorities.medium > 0)
      console.log(`  Medium:   ${priorities.medium}`);
    if (priorities.low > 0)
      console.log(chalk.gray(`  Low:      ${priorities.low}`));
    console.log(
      `\nTasks written to ${chalk.bold(".forge/tasks.md")} and ${chalk.bold(".forge/prd.json")}`
    );
  });

program
  .command("status")
  .description("Show current loop status and quality metrics")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const cwd = process.cwd();
    const forgeDir = resolve(cwd, ".forge");

    const session = new SessionManager(forgeDir);
    session.load();

    if (!session.isActive) {
      console.log(chalk.gray("No active Forge session."));
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(session.state, null, 2));
    } else {
      console.log(chalk.bold("Forge Status:"));
      console.log(`  Session: ${session.sessionId.slice(0, 8)}`);
      console.log(`  Active:  ${session.isActive ? chalk.green("yes") : chalk.red("no")}`);
      console.log(`  Expired: ${session.isExpired ? chalk.red("yes") : chalk.green("no")}`);
      console.log(`  Iteration: ${session.state.lastIteration}`);
      if (session.claudeSessionId) {
        console.log(
          `  Claude Session: ${session.claudeSessionId.slice(0, 8)}`
        );
      }
    }
  });

program
  .command("report")
  .description("Generate a project health report")
  .option(
    "-f, --format <type>",
    "Output format (terminal, html, json)",
    "terminal"
  )
  .action(async (_options) => {
    const { generateReport } = await import("./docs/report.js");

    const data = {
      projectName: process.cwd().split("/").pop() ?? "project",
      generatedAt: new Date().toISOString(),
      sessions: { total: 0, totalIterations: 0, averageIterationsPerSession: 0 },
      tests: {
        total: 0,
        passed: 0,
        failed: 0,
        coverage: { lines: 0, branches: 0, functions: 0 },
      },
      security: {
        findings: { critical: 0, high: 0, medium: 0, low: 0 },
        lastScanAt: "",
        secretsDetected: 0,
      },
      commits: { total: 0, byType: {} as Record<string, number>, conventionalRate: 0 },
      qualityGates: { totalRuns: 0, passRate: 0, mostFailedGate: "" },
      tdd: { cyclesCompleted: 0, violations: 0 },
    };

    // Try to load session history
    const historyPath = resolve(process.cwd(), ".forge", "session-history.json");
    if (existsSync(historyPath)) {
      try {
        const history = JSON.parse(readFileSync(historyPath, "utf-8"));
        data.sessions.total = history.length;
        data.sessions.totalIterations = history.reduce(
          (sum: number, s: { iterations: number }) => sum + s.iterations,
          0
        );
        data.sessions.averageIterationsPerSession =
          data.sessions.total > 0
            ? data.sessions.totalIterations / data.sessions.total
            : 0;
      } catch {}
    }

    // Try to parse git log for commit stats
    try {
      const { execSync } = await import("child_process");
      const log = execSync("git log --oneline -100", {
        cwd: process.cwd(),
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const { parseCommitLog } = await import("./docs/changelog.js");
      const entries = parseCommitLog(log);
      data.commits.total = entries.length;
      for (const e of entries) {
        data.commits.byType[e.type] = (data.commits.byType[e.type] ?? 0) + 1;
      }
      const allCommits = log.split("\n").filter((l) => l.trim()).length;
      data.commits.conventionalRate =
        allCommits > 0
          ? Math.round((entries.length / allCommits) * 1000) / 10
          : 0;
    } catch {}

    const format = (_options.format ?? "terminal") as "terminal" | "json" | "html";
    console.log(generateReport(data, format));
  });

program
  .command("agents")
  .description("List and configure agent roles")
  .action(async () => {
    console.log(chalk.bold.cyan("Forge Agent Team\n"));

    const roles = Object.values(AgentRole);
    for (const role of roles) {
      const def = getAgentDefinition(role);
      const firstLine = def.prompt.split("\n")[0]?.trim() ?? "";
      console.log(
        `  ${chalk.bold(role.padEnd(12))} ${chalk.gray(firstLine)}`
      );
      console.log(
        `  ${"".padEnd(12)} Tools: ${chalk.cyan(def.allowedTools.join(", "))}`
      );
      console.log();
    }
  });

program.parse();
