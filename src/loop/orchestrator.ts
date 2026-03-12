import type { ForgeConfig } from "../config/schema.js";
import { AgentRole } from "../config/schema.js";
import {
  selectAgentForTask,
  getAgentPrompt,
  getAgentAllowedTools,
} from "../agents/roles.js";
import {
  LoopEngine,
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
import { HandoffContext, HandoffPriority } from "../agents/handoff.js";
import { TeamComposer } from "../agents/team.js";
import type { WarningPanelData } from "../tui/error-panel.js";
import {
  IterationPipeline,
  type PhaseExecutor,
  type PhaseResult,
} from "./pipeline.js";

/** Claude Code execution interface */
export interface ClaudeExecutor {
  execute: (options: {
    prompt: string;
    systemPrompt: string;
    allowedTools: string[];
    timeout: number;
    sessionId?: string;
    onStderr?: (line: string) => void;
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
  /** Raw result text from Claude CLI output */
  resultText?: string;
}

/** Options for creating a LoopOrchestrator */
export interface OrchestratorOptions {
  config: ForgeConfig;
  executor: ClaudeExecutor;
  tasks: PrdTask[];
  onDashboardUpdate: (state: DashboardState) => void;
  /** Project root directory for file operations and git commits */
  projectRoot?: string;
  /** Claude session ID for continuity between iterations */
  sessionId?: string;
  /** Extra context to prepend to agent system prompts (e.g. spec-kit context) */
  extraSystemContext?: string;
}

/** State snapshot for TUI dashboard updates */
export interface DashboardState {
  loop: LoopState;
  tddPhase: TddPhase;
  tddCycles: number;
  agentLog: AgentLogEntry[];
  qualityReport?: PipelineResult;
  handoffEntries: number;
  /** Currently executing task name */
  currentTask?: string;
  /** Number of commits created so far */
  commitCount: number;
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
  private _handoffContext: HandoffContext;
  private _teamComposer: TeamComposer;
  private _committedCount = 0;
  private _testFailures = 0;
  private _projectRoot: string;
  private _sessionId?: string;
  private _currentTaskName?: string;
  private _extraSystemContext: string;

  constructor(options: OrchestratorOptions) {
    this._config = options.config;
    this._executor = options.executor;
    this._extraSystemContext = options.extraSystemContext ?? "";
    this._onDashboardUpdate = options.onDashboardUpdate;
    this._projectRoot = options.projectRoot ?? process.cwd();
    this._sessionId = options.sessionId;
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
    this._handoffContext = new HandoffContext();
    this._teamComposer = TeamComposer.fromConfig(options.config.agents);

    this.engine.setTotalTasks(options.tasks.length);

    // Pre-populate completed tasks from scan results
    for (const task of options.tasks) {
      if (task.status === "done") {
        this.engine.recordTaskCompleted(task.id);
      }
    }
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

  /** Access the handoff context for inter-agent communication */
  get handoffContext(): HandoffContext {
    return this._handoffContext;
  }

  /** Get the team iteration pipeline */
  get teamPipeline(): AgentRole[] {
    return this._teamComposer.iterationPipeline();
  }

  /** Get count of commits made */
  get committedCount(): number {
    return this._committedCount;
  }

  /** Get error panel data for TUI display */
  get errorPanelData(): WarningPanelData {
    const cbStats = this.circuitBreakerStats;
    return {
      circuitBreakerState: this.circuitBreaker.state,
      rateLimitRemaining: this._config.maxCallsPerHour - cbStats.totalIterations,
      rateLimitTotal: this._config.maxCallsPerHour,
      permissionDenials: 0,
      buildFailures: 0,
      testFailures: this._testFailures,
    };
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
        this._currentTaskName = undefined;
        this.engine.emitIterationEnd();
        return;
      }

      // Select agent for the task
      this._currentTaskName = currentTask.title;
      this.emitDashboardUpdate();
      const agentRole = this.selectAgent(currentTask.title);
      this.logAgent(agentRole, "selected", `for: ${currentTask.title}`);

      // Build handoff prompt if available
      const handoffPrompt = this._handoffContext.buildPromptFor(agentRole);

      // Build phase executor that delegates to Claude
      const phaseExecutor = this.buildPhaseExecutor(currentTask, handoffPrompt);

      // Create and run the iteration pipeline
      const pipeline = new IterationPipeline({
        tddEnabled: this._config.tdd.enabled,
        securityEnabled: this._config.security.enabled,
        qualityGatesEnabled: true,
        autoCommit: this._config.tdd.commitPerPhase,
        maxPhaseRetries: this._config.retry.maxPhaseRetries,
        retryDelayMs: this._config.retry.retryDelayMs,
      });

      const pipelineResult = await pipeline.execute(
        phaseExecutor,
        (phase) => {
          this.engine.setPhase(phase);
          this.emitDashboardUpdate();
        }
      );

      // Record results
      this.engine.recordFilesModified(pipelineResult.filesModified);
      this._committedCount += pipelineResult.commitsCreated;

      // Update circuit breaker
      this.circuitBreaker.recordIteration({
        filesModified: pipelineResult.filesModified.length,
        error: pipelineResult.error ?? null,
        testsPass: pipelineResult.gatesPassed,
      });
      this.engine.setCircuitBreakerState(this.circuitBreaker.state);

      // Update quality report
      if (pipelineResult.qualityReport) {
        this._qualityReport = pipelineResult.qualityReport;
      }

      // Mark task complete and record handoff for next iteration
      if (pipelineResult.completed && currentTask) {
        this.markTaskComplete(currentTask.id);
        this.logAgent("system", "task-done", `Completed task: ${currentTask.title}`);

        this._handoffContext.add({
          from: agentRole,
          to: AgentRole.Implementer,
          summary: `Completed: ${currentTask.title}`,
          artifacts: pipelineResult.filesModified,
          priority: HandoffPriority.Normal,
        });
      }

      this.logAgent(
        agentRole,
        pipelineResult.completed ? "completed" : "failed",
        pipelineResult.error ?? `${pipelineResult.filesModified.length} files, ${pipelineResult.commitsCreated} commits`
      );
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

  /**
   * Build a PhaseExecutor that delegates each phase to the Claude executor.
   *
   * Each phase constructs the right prompt for the agent role:
   * - Red: Tester agent writes a failing test
   * - Green: Implementer agent writes code to pass
   * - Refactor: Implementer agent cleans up
   */
  private buildPhaseExecutor(
    task: TaskNode,
    handoffPrompt: string
  ): PhaseExecutor {
    const timeout = this._config.timeoutMinutes * 60 * 1000;
    const sessionId = this._sessionId;
    const taskContext = `Task: ${task.title}\nAcceptance criteria: ${(task as TaskNode & { acceptanceCriteria?: string[] }).acceptanceCriteria?.join(", ") ?? ""}`;
    const handoffSection = handoffPrompt ? `\n\n${handoffPrompt}` : "";

    // Accumulates files modified across all phases for security scan and commits
    const allFilesModified: string[] = [];

    return {
      executeRedPhase: async (): Promise<PhaseResult> => {
        this.logAgent(AgentRole.Tester, "red-phase", "Writing failing test");
        const testerPrompt = this._extraSystemContext
          ? `${this._extraSystemContext}\n\n${getAgentPrompt(AgentRole.Tester)}`
          : getAgentPrompt(AgentRole.Tester);
        const response = await this._executor.execute({
          prompt: `[TDD RED PHASE] Write a failing test for:\n${taskContext}${handoffSection}\n\nWrite ONLY the test. Do NOT implement the feature yet.`,
          systemPrompt: testerPrompt,
          allowedTools: getAgentAllowedTools(AgentRole.Tester),
          timeout,
          sessionId,
          onStderr: this.makeStderrHandler(AgentRole.Tester),
        });

        if (response.testResults) {
          this.tddEnforcer.recordTestRun(response.testResults);
          if (response.testResults.failed > 0) {
            this._testFailures = response.testResults.failed;
          }
        }

        allFilesModified.push(...response.filesModified);
        return {
          filesModified: response.filesModified,
          testsPass: response.testsPass,
          testResults: response.testResults,
          error: response.error,
        };
      },

      executeGreenPhase: async (): Promise<PhaseResult> => {
        this.logAgent(AgentRole.Implementer, "green-phase", "Implementing to pass tests");
        const implPrompt = this._extraSystemContext
          ? `${this._extraSystemContext}\n\n${getAgentPrompt(AgentRole.Implementer)}`
          : getAgentPrompt(AgentRole.Implementer);
        const response = await this._executor.execute({
          prompt: `[TDD GREEN PHASE] Implement the MINIMAL code to make the failing test pass:\n${taskContext}${handoffSection}\n\nWrite only enough code to pass the test. Keep it simple.`,
          systemPrompt: implPrompt,
          allowedTools: getAgentAllowedTools(AgentRole.Implementer),
          timeout,
          sessionId,
          onStderr: this.makeStderrHandler(AgentRole.Implementer),
        });

        if (response.testResults) {
          this.tddEnforcer.recordTestRun(response.testResults);
          if (response.testResults.failed > 0) {
            this._testFailures = response.testResults.failed;
          }
        }

        allFilesModified.push(...response.filesModified);
        return {
          filesModified: response.filesModified,
          testsPass: response.testsPass,
          testResults: response.testResults,
          error: response.error,
        };
      },

      executeRefactorPhase: async (): Promise<PhaseResult> => {
        this.logAgent(AgentRole.Implementer, "refactor-phase", "Refactoring");
        const refactorPrompt = this._extraSystemContext
          ? `${this._extraSystemContext}\n\n${getAgentPrompt(AgentRole.Implementer)}`
          : getAgentPrompt(AgentRole.Implementer);
        const response = await this._executor.execute({
          prompt: `[TDD REFACTOR PHASE] Improve code quality without changing behavior:\n${taskContext}\n\nAll tests MUST still pass after refactoring.`,
          systemPrompt: refactorPrompt,
          allowedTools: getAgentAllowedTools(AgentRole.Implementer),
          timeout,
          sessionId,
          onStderr: this.makeStderrHandler(AgentRole.Implementer),
        });

        if (response.testResults) {
          const regression = this.tddEnforcer.checkTestRegression(response.testResults);
          if (regression) {
            this.logAgent("system", "tdd-violation", regression.message);
          }
        }

        allFilesModified.push(...response.filesModified);
        return {
          filesModified: response.filesModified,
          testsPass: response.testsPass,
          testResults: response.testResults,
          error: response.error,
        };
      },

      runSecurityScan: async () => {
        this.logAgent(AgentRole.Security, "scanning", "Running security scan");
        const phaseImpl = await import("./phase-impl.js");
        const result = phaseImpl.scanFilesForSecurity(allFilesModified, this._projectRoot);
        if (!result.passed) {
          this.logAgent(AgentRole.Security, "findings", `${result.findings.length} issues found`);
        }
        return result;
      },

      runQualityGates: async () => {
        this.logAgent("system", "gates", "Running quality gates");
        const phaseImpl = await import("./phase-impl.js");
        const gatePlugin = await import("../gates/plugin.js");
        const registry = new gatePlugin.GatePluginRegistry();

        // Workspace-aware: run tests/lint per affected workspace
        const workspaces = this._config.workspaces;
        if (workspaces && workspaces.length > 0) {
          const affected = this.getAffectedWorkspaces(allFilesModified, workspaces);
          for (const ws of affected) {
            this.logAgent("system", "gates", `Running gates for workspace: ${ws.name}`);
            const builtins = gatePlugin.createBuiltinGates({
              projectRoot: this._projectRoot,
              testCommand: ws.test,
              lintCommand: ws.lint,
            });
            for (const gate of builtins) {
              // Prefix gate name with workspace for clarity
              gate.name = `${ws.name}:${gate.name}`;
              registry.register(gate);
            }
          }
        } else {
          const builtins = gatePlugin.createBuiltinGates({
            projectRoot: this._projectRoot,
            testCommand: this._config.commands.test,
            lintCommand: this._config.commands.lint,
          });
          for (const gate of builtins) {
            registry.register(gate);
          }
        }
        return phaseImpl.runQualityGates(registry.toGateDefinitions());
      },

      executeCommit: async (_type: string, phase: TddPhase) => {
        this.logAgent("system", "commit", `${phase} phase`);
        const phaseImpl = await import("./phase-impl.js");
        return phaseImpl.commitPhase(
          phase,
          allFilesModified,
          task.title,
          this._projectRoot,
          task.id
        );
      },
    };
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

  /**
   * Determine which workspaces are affected by the modified files.
   *
   * A workspace is affected if any modified file path starts with
   * the workspace's path. Root workspace (path ".") is affected
   * by files that don't match any other workspace.
   */
  private getAffectedWorkspaces(
    filesModified: string[],
    workspaces: { name: string; path: string; test: string; lint: string }[]
  ): { name: string; path: string; test: string; lint: string }[] {
    if (filesModified.length === 0) return workspaces;

    const affected = new Set<string>();
    const nonRootWorkspaces = workspaces.filter((ws) => ws.path !== ".");
    const rootWorkspace = workspaces.find((ws) => ws.path === ".");

    for (const file of filesModified) {
      let matched = false;
      for (const ws of nonRootWorkspaces) {
        if (file.startsWith(ws.path + "/") || file === ws.path) {
          affected.add(ws.name);
          matched = true;
        }
      }
      if (!matched && rootWorkspace) {
        affected.add(rootWorkspace.name);
      }
    }

    return workspaces.filter((ws) => affected.has(ws.name));
  }

  private logAgent(agent: string, action: string, detail: string): void {
    this._agentLog.push({
      timestamp: Date.now(),
      agent,
      action,
      detail,
    });
    this.emitDashboardUpdate();
  }

  /**
   * Create an onStderr callback that parses Claude CLI output
   * and logs tool usage as agent activity.
   */
  private makeStderrHandler(agentRole: string): (line: string) => void {
    // Track last log time to throttle dashboard updates
    let lastLogTime = 0;
    const THROTTLE_MS = 500;

    return (line: string) => {
      const now = Date.now();
      if (now - lastLogTime < THROTTLE_MS) return;

      // Claude CLI stderr patterns for tool usage
      const toolMatch = line.match(/(?:Tool|Using|Calling|tool_use).*?(?:Read|Write|Edit|Glob|Grep|Bash|NotebookEdit)\s*(?:\(([^)]*)\))?/i);
      if (toolMatch) {
        lastLogTime = now;
        const detail = toolMatch[1] ? toolMatch[1].slice(0, 60) : line.slice(0, 60);
        this._agentLog.push({
          timestamp: now,
          agent: agentRole,
          action: "tool",
          detail,
        });
        this.emitDashboardUpdate();
        return;
      }

      // File path patterns (reading/writing files)
      const fileMatch = line.match(/(?:Reading|Writing|Editing|Searching)\s+(.+)/i);
      if (fileMatch) {
        lastLogTime = now;
        this._agentLog.push({
          timestamp: now,
          agent: agentRole,
          action: "file",
          detail: fileMatch[1]!.slice(0, 60),
        });
        this.emitDashboardUpdate();
        return;
      }

      // Cost/token patterns
      const costMatch = line.match(/cost[:\s]+\$?([\d.]+)/i);
      if (costMatch) {
        lastLogTime = now;
        this._agentLog.push({
          timestamp: now,
          agent: "system",
          action: "cost",
          detail: `$${costMatch[1]}`,
        });
        this.emitDashboardUpdate();
        return;
      }

      // Generic activity: show truncated stderr as heartbeat (every 3s)
      if (now - lastLogTime >= 3000 && line.length > 5) {
        lastLogTime = now;
        this._agentLog.push({
          timestamp: now,
          agent: agentRole,
          action: "working",
          detail: line.trim().slice(0, 60),
        });
        this.emitDashboardUpdate();
      }
    };
  }

  private emitDashboardUpdate(): void {
    this._onDashboardUpdate({
      loop: this.engine.state,
      tddPhase: this.tddEnforcer.currentPhase,
      tddCycles: this.tddEnforcer.completedCycles,
      agentLog: this._agentLog,
      qualityReport: this._qualityReport,
      handoffEntries: this._handoffContext.entries.length,
      currentTask: this._currentTaskName,
      commitCount: this._committedCount,
    });
  }
}
