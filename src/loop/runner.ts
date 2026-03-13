import { appendFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { ForgeConfig } from "../config/schema.js";
import type { PrdTask } from "../prd/parser.js";
import type { ClaudeExecutor, DashboardState } from "./orchestrator.js";
import { LoopOrchestrator } from "./orchestrator.js";
import { ContextFileManager } from "../agents/context-file.js";
import type { AgentLogEntry } from "../tui/renderer.js";

/** Options for the loop runner */
export interface LoopRunnerOptions {
  config: ForgeConfig;
  executor: ClaudeExecutor;
  tasks: PrdTask[];
  projectRoot?: string;
  forgeDir?: string;
  sessionId?: string;
  /** Resume from previous run, skipping completed tasks */
  resume?: boolean;
  onDashboardUpdate?: (state: DashboardState) => void;
  /** Extra context to prepend to agent system prompts (e.g. spec-kit context) */
  extraSystemContext?: string;
}

/** Result of a complete loop run */
export interface RunResult {
  iterations: number;
  tasksCompleted: number;
  totalTasks: number;
  stopReason: string;
  durationMs: number;
  startedAt: number;
  errors: string[];
  /** Last quality gate report (if available) */
  lastQualityReport?: import("../gates/quality-gates.js").PipelineResult;
  /** Recent agent activity log entries */
  recentLog: import("../tui/renderer.js").AgentLogEntry[];
  /** Path to the full log file */
  logFile?: string;
}

/**
 * High-level loop runner that wraps the orchestrator with
 * signal handling, error collection, and result summarization.
 *
 * This is the main entry point for `forge run`.
 */
export class LoopRunner {
  private orchestrator: LoopOrchestrator;
  private contextManager: ContextFileManager | null;
  private errors: string[] = [];
  private startedAt: number = 0;
  private resume: boolean;
  private logFilePath: string | null = null;
  private forgeDir: string | null;

  constructor(options: LoopRunnerOptions) {
    this.forgeDir = options.forgeDir ?? null;
    this.orchestrator = new LoopOrchestrator({
      config: options.config,
      executor: options.executor,
      tasks: options.tasks,
      projectRoot: options.projectRoot,
      sessionId: options.sessionId,
      onDashboardUpdate: options.onDashboardUpdate ?? (() => {}),
      extraSystemContext: options.extraSystemContext,
    });

    this.resume = options.resume ?? false;

    // Set up context persistence if forgeDir is provided
    this.contextManager = options.forgeDir
      ? ContextFileManager.load(options.forgeDir)
      : null;

    // Set up log file
    if (options.forgeDir) {
      const logsDir = join(options.forgeDir, "logs");
      if (!existsSync(logsDir)) {
        mkdirSync(logsDir, { recursive: true });
      }
      const sessionTag = options.sessionId?.slice(0, 8) ?? Date.now().toString(36);
      this.logFilePath = join(logsDir, `${sessionTag}.jsonl`);
    }
  }

  /**
   * Run the development loop until a stop condition is met.
   *
   * Supports graceful shutdown via AbortSignal.
   * Collects errors but does not throw — returns them in the result.
   */
  async run(signal?: AbortSignal): Promise<RunResult> {
    this.startedAt = Date.now();

    // Restore handoff entries from previous run
    if (this.contextManager) {
      for (const entry of this.contextManager.handoff.entries) {
        this.orchestrator.handoffContext.add(entry);
      }
    }

    // Resume: restore completed task IDs from context
    if (this.resume && this.contextManager) {
      const completedIds = this.contextManager.getSharedState("completedTaskIds") as string[] | undefined;
      if (completedIds && completedIds.length > 0) {
        for (const taskId of completedIds) {
          this.orchestrator.markTaskComplete(taskId);
        }
        this.writeLog({
          timestamp: Date.now(),
          agent: "system",
          action: "resume",
          detail: `Restored ${completedIds.length} completed tasks from previous run`,
        });
      }
    }

    this.writeLog({
      timestamp: Date.now(),
      agent: "system",
      action: "start",
      detail: `Loop started (resume=${this.resume})`,
    });

    try {
      await this.orchestrator.runLoop(signal);
    } catch (err) {
      this.errors.push(
        err instanceof Error ? err.message : String(err)
      );
    }

    // Persist agent logs to disk
    this.flushLogs();

    // Save context for next run
    const completedIds = this.getCompletedTaskIds();
    if (this.contextManager) {
      try {
        this.contextManager.handoff = this.orchestrator.handoffContext;
        this.contextManager.setSharedState("lastIteration", this.orchestrator.state.iteration);
        this.contextManager.setSharedState("committedCount", this.orchestrator.committedCount);

        // Persist completed task IDs for resume
        this.contextManager.setSharedState("completedTaskIds", completedIds);

        this.contextManager.save();
      } catch {
        // Non-fatal — context won't persist
      }
    }

    // Update prd.json and tasks.md on disk to reflect completed tasks
    this.persistTaskStatus(completedIds);

    // Collect any errors from circuit breaker trips
    const cbStats = this.orchestrator.circuitBreakerStats;
    if (cbStats.lastError) {
      this.errors.push(`Last error: ${cbStats.lastError}`);
    }

    const state = this.orchestrator.state;
    let stopReason = this.orchestrator.stopReason ?? "unknown";

    if (signal?.aborted) {
      stopReason = "aborted";
    }

    this.writeLog({
      timestamp: Date.now(),
      agent: "system",
      action: "end",
      detail: `Loop ended: ${stopReason} (${state.tasksCompleted}/${state.totalTasks} tasks)`,
    });
    this.flushLogs();

    return {
      iterations: state.iteration,
      tasksCompleted: state.tasksCompleted,
      totalTasks: state.totalTasks,
      stopReason,
      durationMs: Date.now() - this.startedAt,
      startedAt: this.startedAt,
      errors: [...this.errors],
      lastQualityReport: this.orchestrator.qualityReport,
      recentLog: this.orchestrator.agentLog.slice(-20),
      logFile: this.logFilePath ?? undefined,
    };
  }

  /** Get IDs of completed tasks from the orchestrator state */
  private getCompletedTaskIds(): string[] {
    const state = this.orchestrator.state;
    return [...state.completedTaskIds];
  }

  /**
   * Update prd.json and tasks.md on disk to mark completed tasks as done.
   *
   * This ensures `forge status` shows accurate progress by reading
   * task status directly from the PRD files.
   */
  private persistTaskStatus(completedIds: string[]): void {
    if (!this.forgeDir || completedIds.length === 0) return;

    try {
      // Update prd.json
      const prdJsonPath = join(this.forgeDir, "prd.json");
      if (existsSync(prdJsonPath)) {
        const prdData = JSON.parse(readFileSync(prdJsonPath, "utf-8"));
        if (Array.isArray(prdData.tasks)) {
          for (const task of prdData.tasks) {
            if (completedIds.includes(task.id)) {
              task.status = "done";
            }
          }
          writeFileSync(prdJsonPath, JSON.stringify(prdData, null, 2) + "\n");
        }
      }

      // Update tasks.md — replace [ ] with [x] for completed tasks
      const tasksMdPath = join(this.forgeDir, "tasks.md");
      if (existsSync(tasksMdPath)) {
        let content = readFileSync(tasksMdPath, "utf-8");
        for (const id of completedIds) {
          // Match forge format: - [ ] [task-id] ...
          const forgePattern = new RegExp(`^(- )\\[ \\]( \\[${escapeRegex(id)}\\])`, "gm");
          content = content.replace(forgePattern, "$1[x]$2");
          // Match spec-kit format: - [ ] T001 ...
          const specKitPattern = new RegExp(`^(- )\\[ \\]( ${escapeRegex(id)} )`, "gm");
          content = content.replace(specKitPattern, "$1[x]$2");
        }
        writeFileSync(tasksMdPath, content);
      }

      // Also update specs/tasks.md if it exists (spec-kit format)
      const specsTasksPath = join(this.forgeDir, "..", "specs", "tasks.md");
      if (existsSync(specsTasksPath)) {
        let content = readFileSync(specsTasksPath, "utf-8");
        for (const id of completedIds) {
          const pattern = new RegExp(`^(- )\\[ \\]( ${escapeRegex(id)} )`, "gm");
          content = content.replace(pattern, "$1[x]$2");
        }
        writeFileSync(specsTasksPath, content);
      }
    } catch {
      // Non-fatal — status display may be stale
    }
  }

  /** Write a single log entry to the log file */
  private writeLog(entry: AgentLogEntry): void {
    if (!this.logFilePath) return;
    try {
      appendFileSync(this.logFilePath, JSON.stringify(entry) + "\n");
    } catch {
      // Non-fatal
    }
  }

  /** Flush all orchestrator agent logs to disk */
  private flushLogs(): void {
    if (!this.logFilePath) return;
    try {
      const logs = this.orchestrator.agentLog;
      const lines = logs.map((entry) => JSON.stringify(entry)).join("\n");
      if (lines) {
        appendFileSync(this.logFilePath, lines + "\n");
      }
    } catch {
      // Non-fatal
    }
  }
}

/** Escape special regex characters in a string */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
