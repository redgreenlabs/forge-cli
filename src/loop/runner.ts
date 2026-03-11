import { appendFileSync, mkdirSync, existsSync } from "fs";
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

  constructor(options: LoopRunnerOptions) {
    this.orchestrator = new LoopOrchestrator({
      config: options.config,
      executor: options.executor,
      tasks: options.tasks,
      projectRoot: options.projectRoot,
      sessionId: options.sessionId,
      onDashboardUpdate: options.onDashboardUpdate ?? (() => {}),
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
    if (this.contextManager) {
      try {
        this.contextManager.handoff = this.orchestrator.handoffContext;
        this.contextManager.setSharedState("lastIteration", this.orchestrator.state.iteration);
        this.contextManager.setSharedState("committedCount", this.orchestrator.committedCount);

        // Persist completed task IDs for resume
        const completedIds = this.getCompletedTaskIds();
        this.contextManager.setSharedState("completedTaskIds", completedIds);

        this.contextManager.save();
      } catch {
        // Non-fatal — context won't persist
      }
    }

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
    };
  }

  /** Get IDs of completed tasks from the orchestrator state */
  private getCompletedTaskIds(): string[] {
    const state = this.orchestrator.state;
    return [...state.completedTaskIds];
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
