import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, join } from "path";
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
  .option("--no-scan", "Skip workspace auto-detection")
  .option("-v, --verbose", "Show detailed scan output")
  .action(async (options) => {
    const cwd = process.cwd();

    if (options.interactive) {
      const { generatePrdFromAnswers, getTemplateDefaults, PrdTemplate } =
        await import("./commands/interactive-prd.js");
      const { createInterface } = await import("readline");

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string): Promise<string> =>
        new Promise((resolve) => rl.question(q, resolve));

      console.log(chalk.bold.cyan("\nForge Interactive PRD Creator\n"));

      const projectName = (await ask("Project name: ")).trim() || "my-project";
      const vision = (await ask("Vision (one sentence): ")).trim() || "A new project";

      console.log(chalk.gray("\nTemplates: web-app, cli-tool, library, api"));
      const templateInput = (await ask("Template (or press enter to skip): ")).trim();

      let defaults = { stack: "", features: [] as string[], constraints: [] as string[], nonFunctional: [] as string[] };
      const templateValues: string[] = Object.values(PrdTemplate);
      if (templateInput && templateValues.includes(templateInput)) {
        defaults = getTemplateDefaults(templateInput as typeof PrdTemplate[keyof typeof PrdTemplate]);
        console.log(chalk.green(`  Loaded ${templateInput} template defaults`));
      }

      const stackInput = (await ask(`Tech stack [${defaults.stack || "enter manually"}]: `)).trim();
      const stack = stackInput || defaults.stack || "TypeScript";

      console.log(chalk.gray("\nEnter features (one per line, empty line to finish):"));
      const features = [...defaults.features];
      let feat: string;
      while ((feat = (await ask("  Feature: ")).trim()) !== "") {
        features.push(feat);
      }

      rl.close();

      const prd = generatePrdFromAnswers({
        projectName,
        vision,
        stack,
        features: features.length > 0 ? features : ["Core functionality"],
        constraints: defaults.constraints,
        nonFunctional: defaults.nonFunctional,
      });

      // Init project first, then write PRD
      const initResult = await initProject(cwd, { projectName, force: options.force as boolean | undefined });
      if (!initResult.success) {
        console.error(chalk.red(`Error: ${initResult.error}`));
        process.exit(1);
      }

      const { writeFileSync } = await import("fs");
      const { resolve: pathResolve } = await import("path");
      const prdPath = pathResolve(cwd, ".forge", "specs", "prd.md");
      writeFileSync(prdPath, prd);

      // Also import it as tasks
      const { importPrd } = await import("./commands/import.js");
      importPrd(prdPath, cwd);

      console.log(chalk.green("\nProject initialized with interactive PRD!"));
      console.log(`  PRD:   ${chalk.bold(".forge/specs/prd.md")}`);
      console.log(`  Tasks: ${chalk.bold(".forge/tasks.md")}`);
      console.log(`\nNext: ${chalk.cyan("forge run")}`);
      return;
    }

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

    // Workspace scanning
    if (options.scan !== false) {
      console.log(chalk.gray("\n  Scanning for workspaces..."));
      const { scanWorkspaces } = await import("./commands/workspace-scan.js");
      const wsResult = await scanWorkspaces(cwd, { verbose: options.verbose });
      if (wsResult.workspaces.length > 0) {
        // Write workspaces to config
        const { join } = await import("path");
        const { readFileSync, writeFileSync } = await import("fs");
        const configPath = join(cwd, ".forge", "forge.config.json");
        const config = JSON.parse(readFileSync(configPath, "utf-8"));
        config.workspaces = wsResult.workspaces;
        // Update root commands from first workspace
        const primary = wsResult.workspaces[0]!;
        config.commands.test = primary.test;
        config.commands.lint = primary.lint;
        if (primary.build) config.commands.build = primary.build;
        writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

        console.log(chalk.green(`  Detected ${wsResult.workspaces.length} workspace(s):`));
        for (const ws of wsResult.workspaces) {
          console.log(`    ${chalk.bold(ws.name)} (${ws.type}) — ${ws.path}`);
          console.log(chalk.gray(`      test: ${ws.test}`));
          console.log(chalk.gray(`      lint: ${ws.lint}`));
        }
      } else if (wsResult.error) {
        console.log(chalk.yellow(`  Workspace scan failed: ${wsResult.error}`));
      } else {
        console.log(chalk.gray("  No additional workspaces detected."));
      }
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
  .option("--resume", "Resume from previous run, skipping completed tasks")
  .option("--expedite", "Skip TDD, security, and quality gates for fast prototyping")
  .option("-v, --verbose", "Show detailed executor output")
  .action(async (options) => {
    const cwd = process.cwd();
    const forgeDir = resolve(cwd, ".forge");

    if (!existsSync(forgeDir)) {
      console.error(chalk.red("No .forge directory found. Run `forge init` first."));
      process.exit(1);
    }

    const { config, errors } = loadConfig(cwd);

    if (errors.length > 0) {
      for (const err of errors) {
        console.warn(chalk.yellow(`Config warning: ${err}`));
      }
    }

    const effectiveConfig = {
      ...config,
      maxIterations: options.iterations as number,
      agents: {
        ...config.agents,
        soloMode: options.solo ? true : config.agents.soloMode,
      },
    };

    // Session management
    const session = new SessionManager(resolve(cwd, ".forge"));
    session.load();
    if (session.isActive && !session.isExpired) {
      console.log(
        chalk.cyan(`Resuming session ${session.sessionId.slice(0, 8)}...`)
      );
      if (options.resume) {
        console.log(chalk.cyan("  --resume: will skip previously completed tasks"));
      }
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

    // Load tasks
    const { prepareRunContext } = await import("./commands/run.js");
    const runCtx = prepareRunContext(cwd);

    if (runCtx.tasks.length === 0) {
      console.log(
        chalk.yellow("No tasks found. Run `forge import <prd>` first.")
      );
      return;
    }

    // Auto-detect technology from PRD if commands are still at defaults
    const isDefaultCommands =
      effectiveConfig.commands.test === "npm test" &&
      effectiveConfig.commands.lint === "npm run lint" &&
      effectiveConfig.commands.build === "npm run build";

    if (isDefaultCommands) {
      const prdSpecPath = join(forgeDir, "specs", "prd-original.md");
      const prdJsonPath = join(forgeDir, "prd.json");
      const prdPath = existsSync(prdSpecPath)
        ? prdSpecPath
        : existsSync(prdJsonPath)
          ? prdJsonPath
          : null;

      if (prdPath) {
        const { detectTechFromContent } = await import("./commands/import.js");
        const prdContent = readFileSync(prdPath, "utf-8");
        const detected = detectTechFromContent(prdContent);
        if (detected) {
          effectiveConfig.commands = { ...effectiveConfig.commands, ...detected };
          // Also persist to config file so this only happens once
          const configPath = join(forgeDir, "forge.config.json");
          try {
            const configData = JSON.parse(readFileSync(configPath, "utf-8"));
            configData.commands = { ...configData.commands, ...detected };
            writeFileSync(configPath, JSON.stringify(configData, null, 2) + "\n");
            console.log(
              chalk.gray(`  Auto-detected commands from PRD: test=${detected.test}, lint=${detected.lint}`)
            );
          } catch { /* non-fatal */ }
        }
      }
    }

    // Preflight: validate all required tools and dependencies
    const { runPreflightChecks } = await import("./commands/preflight.js");
    const preflight = runPreflightChecks(effectiveConfig, cwd);

    // Show warnings (non-blocking)
    const warnings = preflight.checks.filter((c) => c.warning);
    if (warnings.length > 0) {
      console.log(chalk.yellow("\n  Preflight warnings:\n"));
      for (const w of warnings) {
        console.log(chalk.yellow(`  ⚠ ${w.message}`));
        if (w.fix) {
          console.log(chalk.gray(`    → ${w.fix}`));
        }
      }
      console.log();
    }

    if (!preflight.passed) {
      console.error(chalk.bold.red("\n  Preflight checks failed:\n"));
      for (const check of preflight.checks) {
        if (!check.ok) {
          console.error(chalk.red(`  ✗ ${check.message}`));
          if (check.fix) {
            for (const line of check.fix.split("\n")) {
              console.error(chalk.gray(`    → ${line}`));
            }
          }
          console.error();
        }
      }
      const passed = preflight.checks.filter((c) => c.ok && !c.warning);
      if (passed.length > 0) {
        console.log(chalk.gray(`  ✓ ${passed.length} checks passed`));
      }
      console.error(
        chalk.yellow(
          "  Fix the issues above and run `forge run` again.\n"
        )
      );
      process.exit(1);
    }

    // Ensure git repo exists — forge relies on git for change tracking
    if (!existsSync(join(cwd, ".git"))) {
      try {
        const { execSync } = await import("child_process");
        execSync("git init", { cwd, stdio: "pipe" });
        execSync("git add -A", { cwd, stdio: "pipe" });
        execSync('git commit -m "chore: initialize project with forge" --allow-empty', {
          cwd,
          stdio: "pipe",
        });
        console.log(chalk.gray("  Initialized git repository for change tracking."));
      } catch {
        console.log(
          chalk.yellow("Warning: No git repository found. File change tracking will be limited.")
        );
      }
    }

    const useTui = options.tui !== false && !options.verbose;

    if (!useTui) {
      console.log(
        chalk.bold.cyan(
          `\nStarting Forge loop (max ${effectiveConfig.maxIterations} iterations)...`
        )
      );
      console.log(chalk.gray("  Press Ctrl+C to stop gracefully.\n"));
      const taskSource = runCtx.specKitContext ? "spec-kit" : "PRD";
      console.log(
        chalk.gray(`  Loaded ${runCtx.tasks.length} tasks from ${taskSource}.`)
      );
    }

    // Create executor
    const { ClaudeCodeExecutor } = await import("./loop/executor.js");
    const executor = new ClaudeCodeExecutor("claude", !!options.verbose, cwd);

    // Handle graceful shutdown
    const controller = new AbortController();

    // Start live TUI dashboard if enabled
    let inkUpdater: ((state: import("./loop/orchestrator.js").DashboardState) => void) | null = null;
    let inkCleanup: (() => void) | null = null;
    let dashRef: { promptTaskFailure: (task: { id: string; title: string; failCount: number; lastError: string | null }) => Promise<import("./loop/orchestrator.js").TaskFailureAction> } | null = null;

    if (useTui) {
      const { startLiveDashboard } = await import("./tui/live-dashboard.js");
      const { CircuitBreakerState } = await import("./loop/circuit-breaker.js");
      const initialDashState: import("./loop/orchestrator.js").DashboardState = {
        loop: {
          iteration: 0,
          phase: LoopPhase.Idle,
          running: false,
          tasksCompleted: 0,
          totalTasks: runCtx.tasks.length,
          filesModifiedThisIteration: 0,
          completedTaskIds: new Set(),
          circuitBreakerState: CircuitBreakerState.Closed,
          startedAt: Date.now(),
          lastIterationAt: null,
        },
        tddPhase: TddPhase.Red,
        tddCycles: 0,
        agentLog: [],
        handoffEntries: 0,
        commitCount: 0,
        claudeLogs: [],
        expedite: options.expedite ? true : undefined,
      };
      const dash = startLiveDashboard(initialDashState, {
        onQuit: () => controller.abort(),
      });
      inkUpdater = dash.updater;
      inkCleanup = dash.cleanup;
      dashRef = dash;
    }

    // Create runner
    const { LoopRunner } = await import("./loop/runner.js");
    const runner = new LoopRunner({
      config: effectiveConfig,
      executor,
      tasks: runCtx.tasks,
      projectRoot: cwd,
      forgeDir: runCtx.forgeDir,
      sessionId: session.claudeSessionId ?? undefined,
      resume: options.resume as boolean | undefined,
      extraSystemContext: runCtx.specKitContext,
      onDashboardUpdate: (dashState) => {
        if (inkUpdater) {
          inkUpdater(dashState);
        } else if (!useTui) {
          // --no-tui or --verbose: static chalk output
          // (verbose mode logs its own output, no need for full dashboard rerender)
        }
      },
      onTaskFailure: dashRef
        ? (task) => dashRef!.promptTaskFailure(task)
        : undefined,
      expedite: options.expedite as boolean | undefined,
    });

    const onSignal = () => {
      console.log(chalk.yellow("\n\nGraceful shutdown..."));
      controller.abort();
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    try {
      const result = await runner.run(controller.signal);

      // Clean up Ink dashboard before printing summary
      if (inkCleanup) {
        inkCleanup();
        inkCleanup = null;
      }

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

      // Detailed quality gate report on failure
      if (result.lastQualityReport && !result.lastQualityReport.passed) {
        console.log(chalk.bold.yellow("\n  Last Quality Gate Report:"));
        for (const gate of result.lastQualityReport.results) {
          const icon = gate.status === "passed" ? chalk.green("✓")
            : gate.status === "failed" ? chalk.red("✗")
            : chalk.yellow("⚠");
          const msg = gate.message.length > 80
            ? gate.message.slice(0, 77) + "..."
            : gate.message;
          console.log(`    ${icon} ${gate.name.padEnd(28)} ${msg}`);
        }
      }

      // Recent agent activity for context
      if (result.recentLog.length > 0) {
        console.log(chalk.bold.cyan("\n  Recent Activity:"));
        const tail = result.recentLog.slice(-10);
        for (const entry of tail) {
          const time = new Date(entry.timestamp).toLocaleTimeString();
          console.log(
            `    ${chalk.gray(time)} ${chalk.white(`[${entry.agent}]`.padEnd(16))} ${entry.action} ${chalk.gray(entry.detail)}`
          );
        }
      }

      // Point to full log file
      if (result.logFile) {
        console.log(chalk.gray(`\n  Full log: ${result.logFile}`));
      }
    } finally {
      // Safety net: unmount Ink if still alive
      if (inkCleanup) inkCleanup();
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
    }
  });

program
  .command("import <file>")
  .description("Import a PRD from a file (Markdown, JSON, or text)")
  .option("--no-scan", "Skip codebase scan for existing implementations")
  .option("--no-decompose", "Skip automatic decomposition of large tasks")
  .option("-v, --verbose", "Show detailed scan output")
  .action(async (file: string, options: { scan?: boolean; decompose?: boolean; verbose?: boolean }) => {
    const cwd = process.cwd();
    console.log(chalk.cyan(`Importing PRD from ${file}...`));

    let result;
    if (options.decompose !== false) {
      const { importPrdWithDecompose } = await import("./commands/import.js");
      console.log(chalk.gray("  Decomposing complex tasks...\n"));
      result = await importPrdWithDecompose(resolve(cwd, file), cwd, {
        verbose: options.verbose,
        onProgress: (progress) => {
          const prefix = chalk.gray(`  [${progress.index}/${progress.total}]`);
          const title = progress.taskTitle.slice(0, 50);
          if (progress.status === "decomposing") {
            process.stdout.write(`${prefix} ${chalk.cyan("⟳")} ${title}...`);
          } else if (progress.status === "decomposed") {
            process.stdout.write(`\r${prefix} ${chalk.green("✓")} ${title} → ${chalk.bold(progress.subtaskCount + " subtasks")}\n`);
          } else if (progress.status === "failed") {
            process.stdout.write(`\r${prefix} ${chalk.red("✗")} ${title} — ${chalk.red("failed")}\n`);
          }
        },
      });
    } else if (options.scan !== false) {
      const { importPrdWithScan } = await import("./commands/import.js");
      console.log(chalk.gray("  Scanning codebase for existing implementations..."));
      result = await importPrdWithScan(resolve(cwd, file), cwd, {
        verbose: options.verbose,
      });
    } else {
      result = importPrd(resolve(cwd, file), cwd);
    }

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

    // Show decomposition results
    if (result.decomposedTasks && result.decomposedTasks > 0) {
      console.log(
        chalk.cyan(`\n  Decomposed ${result.decomposedTasks} large task(s) into ${result.subtasksCreated} subtasks.`)
      );
    }

    // Show scan results
    if (result.scanResults && result.scanResults.length > 0) {
      console.log("");
      for (const sr of result.scanResults) {
        const pct = Math.round(sr.confidence * 100);
        if (sr.status === "done" && sr.confidence >= 0.8) {
          console.log(chalk.green(`  [${sr.taskId}] ${sr.evidence} — done (${pct}%)`));
        } else if (sr.status === "partial") {
          console.log(chalk.yellow(`  [${sr.taskId}] ${sr.evidence} — partial (${pct}%, skipped)`));
        } else if (sr.status === "done" && sr.confidence < 0.8) {
          console.log(chalk.yellow(`  [${sr.taskId}] ${sr.evidence} — done but low confidence (${pct}%, skipped)`));
        }
      }
      if (result.tasksPreMarkedDone && result.tasksPreMarkedDone > 0) {
        console.log(
          chalk.green(`\n  Pre-marked ${result.tasksPreMarkedDone} of ${result.tasksImported} tasks as done.`)
        );
      }
    }

    console.log(
      `\nTasks written to ${chalk.bold(".forge/tasks.md")} and ${chalk.bold(".forge/prd.json")}`
    );
  });

program
  .command("status")
  .description("Show current loop status and quality metrics")
  .option("--json", "Output as JSON")
  .option("-w, --watch", "Refresh status every few seconds")
  .option("--interval <seconds>", "Watch interval in seconds", (v) => parseInt(v, 10), 3)
  .action(async (options) => {
    const cwd = process.cwd();
    const forgeDir = resolve(cwd, ".forge");

    if (!existsSync(forgeDir)) {
      console.log(chalk.gray("No .forge directory found. Run `forge init` first."));
      return;
    }

    const renderStatus = async () => {
      const session = new SessionManager(forgeDir);
      session.load();

      const { ContextFileManager } = await import("./agents/context-file.js");
      const context = ContextFileManager.load(forgeDir);

      const { prepareRunContext } = await import("./commands/run.js");
      const runCtx = prepareRunContext(cwd);
      const totalTasks = runCtx.tasks.length;
      const completedTasks = runCtx.tasks.filter(
        (t) => t.status === "done"
      ).length;

      const { config } = loadConfig(cwd);

      if (options.json) {
        const data = {
          session: session.isActive ? session.state : null,
          tasks: { total: totalTasks, completed: completedTasks },
          context: {
            handoffEntries: context.handoff.entries.length,
            lastIteration: context.getSharedState("lastIteration") ?? null,
            committedCount: context.getSharedState("committedCount") ?? null,
          },
          config: {
            tdd: config.tdd.enabled,
            security: config.security.enabled,
            maxIterations: config.maxIterations,
            commands: config.commands,
          },
        };
        return JSON.stringify(data, null, 2);
      }

      const lines: string[] = [];
      lines.push(chalk.bold.cyan("Forge Status\n"));

      // Session section
      if (session.isActive) {
        lines.push(chalk.bold("Session"));
        lines.push(`  ID:        ${session.sessionId.slice(0, 8)}`);
        lines.push(`  Active:    ${chalk.green("yes")}`);
        lines.push(`  Expired:   ${session.isExpired ? chalk.red("yes") : chalk.green("no")}`);
        lines.push(`  Iteration: ${session.state.lastIteration}`);
        if (session.state.lastIterationAt) {
          const ago = Math.round((Date.now() - session.state.lastIterationAt) / 1000);
          lines.push(`  Last run:  ${formatTimeAgo(ago)}`);
        }
        if (session.claudeSessionId) {
          lines.push(`  Claude:    ${session.claudeSessionId.slice(0, 8)}`);
        }
        if (session.state.completionReason) {
          lines.push(`  Completed: ${chalk.green(session.state.completionReason)}`);
        }
      } else {
        lines.push(chalk.gray("No active session."));
      }

      // Tasks section
      lines.push(chalk.bold("\nTasks"));
      if (totalTasks > 0) {
        const pct = Math.round((completedTasks / totalTasks) * 100);
        const bar = renderProgressBarSimple(pct, 20);
        lines.push(`  Progress:  ${bar} ${completedTasks}/${totalTasks} (${pct}%)`);
        const remaining = totalTasks - completedTasks;
        if (remaining > 0) {
          lines.push(`  Remaining: ${remaining} tasks`);
        } else {
          lines.push(`  ${chalk.green("All tasks complete!")}`);
        }
      } else {
        lines.push(chalk.gray("  No tasks loaded. Run `forge import <prd>` first."));
      }

      // Context section (from last run)
      const lastIter = context.getSharedState("lastIteration") as number | undefined;
      const commits = context.getSharedState("committedCount") as number | undefined;
      const handoffCount = context.handoff.entries.length;
      if (lastIter || commits || handoffCount > 0) {
        lines.push(chalk.bold("\nLast Run"));
        if (lastIter) lines.push(`  Iterations: ${lastIter}`);
        if (commits) lines.push(`  Commits:    ${commits}`);
        if (handoffCount > 0) {
          lines.push(`  Handoffs:   ${handoffCount} entries`);
          const recent = context.handoff.entries.slice(-3);
          for (const entry of recent) {
            lines.push(`    ${chalk.gray("→")} ${entry.summary}`);
          }
        }
      }

      // Config section
      lines.push(chalk.bold("\nConfig"));
      lines.push(`  TDD:        ${config.tdd.enabled ? chalk.green("on") : chalk.gray("off")}`);
      lines.push(`  Security:   ${config.security.enabled ? chalk.green("on") : chalk.gray("off")}`);
      lines.push(`  Max iters:  ${config.maxIterations}`);
      lines.push(`  Test cmd:   ${chalk.cyan(config.commands.test)}`);
      lines.push(`  Lint cmd:   ${chalk.cyan(config.commands.lint)}`);

      return lines.join("\n");
    };

    if (options.watch) {
      const intervalMs = (options.interval as number) * 1000;
      console.log(chalk.gray(`Watching every ${options.interval}s — Ctrl+C to stop\n`));

      const tick = async () => {
        process.stdout.write("\x1B[2J\x1B[H"); // clear screen
        console.log(await renderStatus());
        console.log(chalk.gray(`\n  Refreshing every ${options.interval}s — Ctrl+C to stop`));
      };

      await tick();
      const timer = setInterval(tick, intervalMs);
      process.on("SIGINT", () => {
        clearInterval(timer);
        process.exit(0);
      });
      // Keep process alive
      await new Promise(() => {});
    } else {
      console.log(await renderStatus());
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
    const cwd = process.cwd();
    const forgeDir = resolve(cwd, ".forge");
    const { generateReport } = await import("./docs/report.js");

    const data = {
      projectName: cwd.split("/").pop() ?? "project",
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

    // Load session history
    const historyPath = resolve(forgeDir, "session-history.json");
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

    // Load context file for accumulated stats
    if (existsSync(forgeDir)) {
      try {
        const { ContextFileManager } = await import("./agents/context-file.js");
        const context = ContextFileManager.load(forgeDir);
        const tddCycles = context.getSharedState("tddCycles") as number | undefined;
        const tddViolations = context.getSharedState("tddViolations") as number | undefined;
        if (tddCycles) data.tdd.cyclesCompleted = tddCycles;
        if (tddViolations) data.tdd.violations = tddViolations;
      } catch {}
    }

    // Load task progress
    if (existsSync(forgeDir)) {
      try {
        const { prepareRunContext } = await import("./commands/run.js");
        const runCtx = prepareRunContext(cwd);
        const total = runCtx.tasks.length;
        const done = runCtx.tasks.filter((t) => t.status === "done").length;
        if (total > 0) {
          data.qualityGates.totalRuns = total;
          data.qualityGates.passRate = Math.round((done / total) * 100);
        }
      } catch {}
    }

    // Parse git log for commit stats
    try {
      const { execSync } = await import("child_process");
      const log = execSync("git log --oneline -100", {
        cwd,
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
  .command("decompose")
  .description("Decompose large PRD tasks into smaller TDD-friendly subtasks")
  .option("--threshold <n>", "Complexity threshold (1-10)", (v) => parseInt(v, 10))
  .option("--max-subtasks <n>", "Max subtasks per parent", (v) => parseInt(v, 10))
  .option("--dry-run", "Show which tasks would be decomposed without calling Claude")
  .option("-v, --verbose", "Show detailed output")
  .action(async (options) => {
    const cwd = process.cwd();
    const forgeDir = resolve(cwd, ".forge");

    if (!existsSync(forgeDir)) {
      console.error(chalk.red("No .forge directory found. Run `forge init` first."));
      process.exit(1);
    }

    const prdJsonPath = join(forgeDir, "prd.json");
    if (!existsSync(prdJsonPath)) {
      console.error(chalk.red("No prd.json found. Run `forge import <prd>` first."));
      process.exit(1);
    }

    const { config } = loadConfig(cwd);
    const threshold = (options.threshold as number | undefined) ?? config.decompose.complexityThreshold;
    const maxSubtasks = (options.maxSubtasks as number | undefined) ?? config.decompose.maxSubtasks;

    const prdData = JSON.parse(readFileSync(prdJsonPath, "utf-8"));
    const { estimateTaskComplexity } = await import("./prd/decomposer.js");

    console.log(chalk.bold.cyan("Task Complexity Analysis\n"));

    let complexCount = 0;
    for (const task of prdData.tasks) {
      const score = estimateTaskComplexity(task);
      const isComplex = score >= threshold;
      if (isComplex) complexCount++;

      const bar = "█".repeat(score) + "░".repeat(10 - score);
      const color = isComplex ? chalk.red : chalk.green;
      const label = isComplex ? chalk.red("DECOMPOSE") : chalk.green("OK");
      console.log(`  ${color(bar)} ${score}/10  ${label}  ${task.id} ${chalk.gray(task.title.slice(0, 60))}`);
    }

    if (complexCount === 0) {
      console.log(chalk.green("\nAll tasks are within complexity threshold. Nothing to decompose."));
      return;
    }

    console.log(chalk.yellow(`\n${complexCount} task(s) above threshold (${threshold}).`));

    if (options.dryRun) {
      console.log(chalk.gray("\n[DRY RUN] No changes made."));
      return;
    }

    console.log(chalk.cyan("\nDecomposing with Claude...\n"));

    const { ClaudeCodeExecutor } = await import("./loop/executor.js");
    const { decomposeTaskList } = await import("./prd/decomposer.js");

    const executor = new ClaudeCodeExecutor("claude", !!options.verbose, cwd);
    const result = await decomposeTaskList(prdData.tasks, executor, {
      enabled: true,
      maxSubtasks,
      complexityThreshold: threshold,
    }, (progress) => {
      const prefix = chalk.gray(`  [${progress.index}/${progress.total}]`);
      const title = progress.taskTitle.slice(0, 50);
      switch (progress.status) {
        case "decomposing":
          process.stdout.write(`${prefix} ${chalk.cyan("⟳")} Decomposing: ${title}...`);
          break;
        case "decomposed":
          process.stdout.write(`\r${prefix} ${chalk.green("✓")} ${title} → ${chalk.bold(progress.subtaskCount + " subtasks")}\n`);
          break;
        case "failed":
          process.stdout.write(`\r${prefix} ${chalk.red("✗")} ${title} — ${chalk.red("failed, keeping original")}\n`);
          break;
        case "skipped":
          process.stdout.write(`\r${prefix} ${chalk.yellow("–")} ${title} — ${chalk.yellow("too few subtasks, keeping original")}\n`);
          break;
      }
    });

    if (result.decomposedCount === 0) {
      console.log(chalk.yellow("No tasks were decomposed (Claude may not have produced valid output)."));
      return;
    }

    // Write back
    prdData.tasks = result.tasks.map((t: import("./prd/parser.js").PrdTask) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      category: t.category,
      acceptanceCriteria: t.acceptanceCriteria,
      dependsOn: t.dependsOn,
    }));
    writeFileSync(prdJsonPath, JSON.stringify(prdData, null, 2) + "\n");

    // Regenerate tasks.md
    const { parsePrd } = await import("./prd/parser.js");
    const specsPath = join(forgeDir, "specs", "prd-original.md");
    let prdTitle = prdData.title ?? "Tasks";
    if (existsSync(specsPath)) {
      try {
        const original = parsePrd(readFileSync(specsPath, "utf-8"), "prd.md");
        prdTitle = original.title;
      } catch { /* use fallback */ }
    }

    // Build tasks.md from decomposed tasks
    const lines: string[] = [`# ${prdTitle}`, ""];
    const byPriority = new Map<string, typeof result.tasks>();
    for (const task of result.tasks) {
      const key = task.priority;
      if (!byPriority.has(key)) byPriority.set(key, []);
      byPriority.get(key)!.push(task);
    }
    for (const priority of ["critical", "high", "medium", "low"]) {
      const tasks = byPriority.get(priority);
      if (!tasks || tasks.length === 0) continue;
      lines.push(`## Priority: ${priority.charAt(0).toUpperCase() + priority.slice(1)}`);
      for (const task of tasks) {
        const checkbox = task.status === "done" ? "[x]" : "[ ]";
        const deps = task.dependsOn.length > 0 ? ` (depends: ${task.dependsOn.join(", ")})` : "";
        lines.push(`- ${checkbox} [${task.id}] ${task.title}${deps}`);
        for (const c of task.acceptanceCriteria) {
          lines.push(`  - ${c}`);
        }
      }
      lines.push("");
    }
    writeFileSync(join(forgeDir, "tasks.md"), lines.join("\n"));

    console.log(chalk.green(`\nDecomposed ${result.decomposedCount} task(s) into ${result.subtasksCreated} subtasks.`));
    console.log(`Total tasks: ${result.tasks.length}`);
    console.log(`\nUpdated ${chalk.bold(".forge/prd.json")} and ${chalk.bold(".forge/tasks.md")}`);
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

/** Format seconds ago into human-readable string */
function formatTimeAgo(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

/** Simple ASCII progress bar */
function renderProgressBarSimple(pct: number, width: number): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return `[${chalk.green("█".repeat(filled))}${chalk.gray("░".repeat(empty))}]`;
}

program.parse();
