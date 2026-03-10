import type { ForgeConfig } from "../config/schema.js";
import type { PrdTask } from "../prd/parser.js";
import type { ClaudeExecutor, DashboardState } from "./orchestrator.js";
import { LoopOrchestrator } from "./orchestrator.js";

/** Options for the loop runner */
export interface LoopRunnerOptions {
  config: ForgeConfig;
  executor: ClaudeExecutor;
  tasks: PrdTask[];
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
  private errors: string[] = [];
  private startedAt: number = 0;

  constructor(options: LoopRunnerOptions) {
    this.orchestrator = new LoopOrchestrator({
      config: options.config,
      executor: options.executor,
      tasks: options.tasks,
      onDashboardUpdate: options.onDashboardUpdate ?? (() => {}),
    });
  }

  /**
   * Run the development loop until a stop condition is met.
   *
   * Supports graceful shutdown via AbortSignal.
   * Collects errors but does not throw — returns them in the result.
   */
  async run(signal?: AbortSignal): Promise<RunResult> {
    this.startedAt = Date.now();

    try {
      await this.orchestrator.runLoop(signal);
    } catch (err) {
      this.errors.push(
        err instanceof Error ? err.message : String(err)
      );
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
}
