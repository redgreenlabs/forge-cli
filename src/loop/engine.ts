import type { ForgeConfig } from "../config/schema.js";
import { CircuitBreakerState } from "./circuit-breaker.js";
import type { PipelineResult } from "../gates/quality-gates.js";

/** Phases of a single loop iteration */
export enum LoopPhase {
  Idle = "idle",
  Planning = "planning",
  Testing = "testing",
  Implementing = "implementing",
  Reviewing = "reviewing",
  SecurityScan = "security_scan",
  Committing = "committing",
  QualityGate = "quality_gate",
  Documenting = "documenting",
}

/** Observable state of the loop engine */
export interface LoopState {
  iteration: number;
  phase: LoopPhase;
  running: boolean;
  tasksCompleted: number;
  totalTasks: number;
  completedTaskIds: Set<string>;
  filesModifiedThisIteration: number;
  circuitBreakerState: CircuitBreakerState;
  startedAt: number;
  lastIterationAt: number | null;
}

/** Why the loop stopped */
export type StopReason =
  | "max_iterations_reached"
  | "all_tasks_complete"
  | "circuit_breaker_open"
  | "manual_stop"
  | "error"
  | null;

/** Event handlers for loop lifecycle */
export interface LoopEventHandler {
  onIterationStart: (state: LoopState) => void;
  onIterationEnd: (state: LoopState) => void;
  onPhaseChange: (phase: LoopPhase) => void;
  onQualityGateResult: (result: PipelineResult) => void;
  onError: (error: Error) => void;
  onComplete: (state: LoopState) => void;
}

/** Serializable loop state for persistence */
export interface LoopSnapshot {
  iteration: number;
  phase: LoopPhase;
  tasksCompleted: number;
  totalTasks: number;
  completedTaskIds: string[];
  circuitBreakerState: CircuitBreakerState;
  startedAt: number;
}

/**
 * Core loop engine that manages iteration state, phase transitions,
 * stop conditions, and event emission.
 *
 * The engine itself does not execute Claude Code — it provides the
 * state machine and event infrastructure that the loop runner orchestrates.
 */
export class LoopEngine {
  private _state: LoopState;
  private _stopReason: StopReason = null;
  private _config: ForgeConfig;
  private _handler: LoopEventHandler;

  constructor(config: ForgeConfig, handler: LoopEventHandler) {
    this._config = config;
    this._handler = handler;
    this._state = {
      iteration: 0,
      phase: LoopPhase.Idle,
      running: false,
      tasksCompleted: 0,
      totalTasks: 0,
      completedTaskIds: new Set(),
      filesModifiedThisIteration: 0,
      circuitBreakerState: CircuitBreakerState.Closed,
      startedAt: Date.now(),
      lastIterationAt: null,
    };
  }

  get state(): LoopState {
    return this._state;
  }

  get stopReason(): StopReason {
    return this._stopReason;
  }

  /** Advance to the next iteration */
  incrementIteration(): void {
    this._state.iteration++;
    this._state.filesModifiedThisIteration = 0;
    this._state.lastIterationAt = Date.now();
  }

  /** Transition to a new phase */
  setPhase(phase: LoopPhase): void {
    this._state.phase = phase;
    this._handler.onPhaseChange(phase);
  }

  /** Set the total number of tasks */
  setTotalTasks(total: number): void {
    this._state.totalTasks = total;
  }

  /** Record a task as completed */
  recordTaskCompleted(taskId: string): void {
    this._state.completedTaskIds.add(taskId);
    this._state.tasksCompleted = this._state.completedTaskIds.size;
  }

  /** Record files modified in this iteration */
  recordFilesModified(files: string[]): void {
    this._state.filesModifiedThisIteration = files.length;
  }

  /** Update circuit breaker state */
  setCircuitBreakerState(state: CircuitBreakerState): void {
    this._state.circuitBreakerState = state;
  }

  /** Check if the loop should stop */
  shouldStop(): boolean {
    if (this._state.iteration >= this._config.maxIterations) {
      this._stopReason = "max_iterations_reached";
      return true;
    }

    if (
      this._state.totalTasks > 0 &&
      this._state.tasksCompleted >= this._state.totalTasks
    ) {
      this._stopReason = "all_tasks_complete";
      return true;
    }

    if (this._state.circuitBreakerState === CircuitBreakerState.Open) {
      this._stopReason = "circuit_breaker_open";
      return true;
    }

    return false;
  }

  /** Emit iteration start event */
  emitIterationStart(): void {
    this._handler.onIterationStart(this._state);
  }

  /** Emit iteration end event */
  emitIterationEnd(): void {
    this._handler.onIterationEnd(this._state);
  }

  /** Emit completion event */
  emitComplete(): void {
    this._handler.onComplete(this._state);
  }

  /** Emit error event */
  emitError(error: Error): void {
    this._handler.onError(error);
  }

  /** Serialize state for persistence */
  toJSON(): LoopSnapshot {
    return {
      iteration: this._state.iteration,
      phase: this._state.phase,
      tasksCompleted: this._state.tasksCompleted,
      totalTasks: this._state.totalTasks,
      completedTaskIds: Array.from(this._state.completedTaskIds),
      circuitBreakerState: this._state.circuitBreakerState,
      startedAt: this._state.startedAt,
    };
  }

  /** Restore loop engine from a serialized snapshot */
  static fromJSON(
    snapshot: LoopSnapshot,
    config: ForgeConfig,
    handler: LoopEventHandler
  ): LoopEngine {
    const engine = new LoopEngine(config, handler);
    engine._state.iteration = snapshot.iteration;
    engine._state.phase = snapshot.phase;
    engine._state.totalTasks = snapshot.totalTasks;
    engine._state.completedTaskIds = new Set(snapshot.completedTaskIds);
    engine._state.tasksCompleted = snapshot.completedTaskIds.length;
    engine._state.circuitBreakerState = snapshot.circuitBreakerState;
    engine._state.startedAt = snapshot.startedAt;
    return engine;
  }
}
