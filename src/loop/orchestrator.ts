import type { ForgeConfig } from "../config/schema.js";
import { AgentRole } from "../config/schema.js";
import { selectAgentForTask, getAgentPrompt } from "../agents/roles.js";
import {
  LoopEngine,
  LoopPhase,
  type LoopState,
  type LoopEventHandler,
} from "./engine.js";
import {
  CircuitBreaker,
  type CircuitBreakerStats,
} from "./circuit-breaker.js";
import { TddEnforcer, TddPhase } from "../tdd/enforcer.js";
import { TaskGraph, type TaskNode } from "../prd/task-graph.js";
import type { PrdTask } from "../prd/parser.js";
import type { PipelineResult } from "../gates/quality-gates.js";
import type { AgentLogEntry } from "../tui/renderer.js";

/** Claude Code execution interface */
export interface ClaudeExecutor {
  execute: (options: {
    prompt: string;
    systemPrompt: string;
    allowedTools: string[];
    timeout: number;
  }) => Promise<ClaudeResponse>;
}

/** Response from Claude Code execution */
export interface ClaudeResponse {
  status: string;
  exitSignal: boolean;
  filesModified: string[];
  testsPass: boolean;
  testResults: { total: number; passed: number; failed: number };
  error: string | null;
}

/** Options for creating a LoopOrchestrator */
export interface OrchestratorOptions {
  config: ForgeConfig;
  executor: ClaudeExecutor;
  tasks: PrdTask[];
  onDashboardUpdate: (state: DashboardState) => void;
}

/** State snapshot for TUI dashboard updates */
export interface DashboardState {
  loop: LoopState;
  tddPhase: TddPhase;
  tddCycles: number;
  agentLog: AgentLogEntry[];
  qualityReport?: PipelineResult;
}

/**
 * The LoopOrchestrator ties together agents, TDD enforcement, quality gates,
 * and the loop engine into a cohesive execution pipeline.
 *
 * Each iteration follows this sequence:
 * 1. Select next task from dependency graph
 * 2. Select appropriate agent for the task
 * 3. Execute TDD Red phase (write failing test)
 * 4. Execute TDD Green phase (implement)
 * 5. Execute TDD Refactor phase
 * 6. Run quality gates
 * 7. Commit with conventional commit
 * 8. Update dashboard
 */
export class LoopOrchestrator {
  private engine: LoopEngine;
  private circuitBreaker: CircuitBreaker;
  private tddEnforcer: TddEnforcer;
  private taskGraph: TaskGraph;
  private _agentLog: AgentLogEntry[] = [];
  private _qualityReport?: PipelineResult;
  private _config: ForgeConfig;
  private _executor: ClaudeExecutor;
  private _onDashboardUpdate: (state: DashboardState) => void;
  private _startTime: number;

  constructor(options: OrchestratorOptions) {
    this._config = options.config;
    this._executor = options.executor;
    this._onDashboardUpdate = options.onDashboardUpdate;
    this._startTime = Date.now();

    const handler: LoopEventHandler = {
      onIterationStart: () => this.emitDashboardUpdate(),
      onIterationEnd: () => this.emitDashboardUpdate(),
      onPhaseChange: () => this.emitDashboardUpdate(),
      onQualityGateResult: (result) => {
        this._qualityReport = result;
        this.emitDashboardUpdate();
      },
      onError: (error) => this.logAgent("system", "error", error.message),
      onComplete: () => this.emitDashboardUpdate(),
    };

    this.engine = new LoopEngine(options.config, handler);
    this.circuitBreaker = new CircuitBreaker(options.config.circuitBreaker);
    this.tddEnforcer = new TddEnforcer();
    this.taskGraph = new TaskGraph(options.tasks as TaskNode[]);

    this.engine.setTotalTasks(options.tasks.length);
  }

  get state(): LoopState {
    return this.engine.state;
  }

  get stopReason() {
    return this.engine.stopReason;
  }

  get circuitBreakerStats(): CircuitBreakerStats {
    return this.circuitBreaker.stats;
  }

  get qualityReport(): PipelineResult | undefined {
    return this._qualityReport;
  }

  get agentLog(): AgentLogEntry[] {
    return [...this._agentLog];
  }

  get elapsedMs(): number {
    return Date.now() - this._startTime;
  }

  /** Select the best agent for a task description */
  selectAgent(taskDescription: string): AgentRole {
    return selectAgentForTask(taskDescription, this._config.agents.team);
  }

  /** Execute a single iteration of the loop */
  async runIteration(): Promise<void> {
    this.engine.incrementIteration();
    this.engine.emitIterationStart();

    try {
      // Select next task
      const nextTasks = this.taskGraph.nextAvailable();
      const currentTask = nextTasks[0];

      if (!currentTask) {
        this.logAgent("system", "info", "No available tasks");
        this.engine.emitIterationEnd();
        return;
      }

      // Select agent
      const agentRole = this.selectAgent(currentTask.title);
      const agentPrompt = getAgentPrompt(agentRole);
      this.logAgent(agentRole, "selected", `for: ${currentTask.title}`);

      // Execute Claude
      this.engine.setPhase(LoopPhase.Implementing);
      const response = await this._executor.execute({
        prompt: `Task: ${currentTask.title}\nAcceptance criteria: ${currentTask.acceptanceCriteria.join(", ")}`,
        systemPrompt: agentPrompt,
        allowedTools: [],
        timeout: this._config.timeoutMinutes * 60 * 1000,
      });

      // Record results
      this.engine.recordFilesModified(response.filesModified);
      this.logAgent(
        agentRole,
        "completed",
        `${response.filesModified.length} files modified`
      );

      // Update circuit breaker
      this.circuitBreaker.recordIteration({
        filesModified: response.filesModified.length,
        error: response.error,
        testsPass: response.testsPass,
      });
      this.engine.setCircuitBreakerState(this.circuitBreaker.state);

      // Update TDD enforcer
      if (response.testResults) {
        this.tddEnforcer.recordTestRun(response.testResults);
      }

      // Quality gate phase
      this.engine.setPhase(LoopPhase.QualityGate);
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error(String(error));
      this.engine.emitError(err);
      this.circuitBreaker.recordIteration({
        filesModified: 0,
        error: err.message,
        testsPass: false,
      });
      this.engine.setCircuitBreakerState(this.circuitBreaker.state);
    }

    this.engine.emitIterationEnd();
  }

  /** Run the full loop until a stop condition is met */
  async runLoop(signal?: AbortSignal): Promise<void> {
    while (!this.shouldStop()) {
      if (signal?.aborted) {
        break;
      }
      await this.runIteration();
    }
    this.engine.emitComplete();
  }

  /** Check if the loop should stop */
  shouldStop(): boolean {
    return this.engine.shouldStop();
  }

  /** Mark a task as complete */
  markTaskComplete(taskId: string): void {
    this.taskGraph.markComplete(taskId);
    this.engine.recordTaskCompleted(taskId);
  }

  private logAgent(agent: string, action: string, detail: string): void {
    this._agentLog.push({
      timestamp: Date.now(),
      agent,
      action,
      detail,
    });
  }

  private emitDashboardUpdate(): void {
    this._onDashboardUpdate({
      loop: this.engine.state,
      tddPhase: this.tddEnforcer.currentPhase,
      tddCycles: this.tddEnforcer.completedCycles,
      agentLog: this._agentLog,
      qualityReport: this._qualityReport,
    });
  }
}
