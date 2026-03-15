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
import type { AgentLogEntry, CodeQualityMetrics, CoverageMetrics, SecurityMetrics } from "../tui/renderer.js";
import { HandoffContext, HandoffPriority } from "../agents/handoff.js";
import { TeamComposer } from "../agents/team.js";
import type { WarningPanelData } from "../tui/error-panel.js";
import {
  IterationPipeline,
  type PhaseExecutor,
  type PhaseResult,
} from "./pipeline.js";
import { RateLimiter } from "./rate-limiter.js";
import { computeCodeMetrics } from "../metrics/code-metrics.js";
import {
  getHeadSha,
  detectFilesFromCommits,
  countCommitsBetween,
} from "./executor.js";

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
  /** Whether the error was caused by context window exhaustion */
  contextExhausted?: boolean;
  /** Whether the error was caused by API rate limiting */
  rateLimited?: boolean;
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
  /** Code quality metrics (complexity + test ratio) */
  codeMetrics?: CodeQualityMetrics;
  /** Coverage metrics from last test run */
  coverage?: CoverageMetrics;
  /** Security scan findings summary */
  security?: SecurityMetrics;
  /** Rate limit wait state (when pausing for API cooldown) */
  rateLimitWaiting?: { until: number; reason: string };
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
  private rateLimiter: RateLimiter;
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
  private _codeMetrics?: CodeQualityMetrics;
  private _securityMetrics?: SecurityMetrics;
  private _rateLimitWaiting?: { until: number; reason: string };
  private _exitSignalCount = new Map<string, number>();

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
    this.rateLimiter = RateLimiter.perHour(options.config.maxCallsPerHour);
    this.tddEnforcer = new TddEnforcer();
    this.taskGraph = new TaskGraph(options.tasks as TaskNode[]);
    this._handoffContext = new HandoffContext();
    this._teamComposer = TeamComposer.fromConfig(options.config.agents);

    this.engine.setTotalTasks(options.tasks.length);

    // Pre-populate completed tasks from scan results
    for (const task of options.tasks) {
      if (task.status === "done") {
        this.taskGraph.markComplete(task.id);
        this.engine.recordTaskCompleted(task.id);
      }
    }

    // Compute initial code metrics
    this.refreshCodeMetrics();
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
    return {
      circuitBreakerState: this.circuitBreaker.state,
      rateLimitRemaining: this.rateLimiter.remaining,
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
    this.rateLimiter.record();

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

      // Snapshot HEAD before the iteration to detect commits made by Claude
      const headBefore = getHeadSha(this._projectRoot);

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

      // Reconcile: if pipeline reports 0 files but git shows commits were made,
      // use git to detect the actual files changed. This handles the case where
      // Claude commits files during execution, making them invisible to git status.
      let filesModified = pipelineResult.filesModified;
      let commitsCreated = pipelineResult.commitsCreated;

      if (headBefore) {
        const gitCommitCount = countCommitsBetween(this._projectRoot, headBefore);
        if (gitCommitCount > 0) {
          if (filesModified.length === 0) {
            filesModified = detectFilesFromCommits(this._projectRoot, headBefore);
          }
          if (commitsCreated === 0) {
            commitsCreated = gitCommitCount;
          }
        }
      }

      // If the pipeline completed a task successfully but no files were detected
      // (e.g. no git repo, or files committed by Claude before we could check),
      // treat it as progress so the circuit breaker doesn't trip falsely.
      if (pipelineResult.completed && filesModified.length === 0) {
        filesModified = ["(task completed — file detection unavailable)"];
      }

      // Record results
      this.engine.recordFilesModified(filesModified);
      this._committedCount += commitsCreated;

      // Update circuit breaker.
      // When the pipeline failed (quality gates, phase error), count it as
      // no progress even if files were modified — the work was wasted and
      // retrying the same task will likely fail the same way.
      this.circuitBreaker.recordIteration({
        filesModified: pipelineResult.completed ? filesModified.length : 0,
        error: pipelineResult.error ?? null,
        testsPass: pipelineResult.gatesPassed,
      });
      this.engine.setCircuitBreakerState(this.circuitBreaker.state);

      // Update quality report
      if (pipelineResult.qualityReport) {
        this._qualityReport = pipelineResult.qualityReport;
      }

      // Dual-condition exit: require BOTH pipeline success AND exit signal
      // to mark a task complete. This prevents premature completion when
      // Claude says "done" but the task isn't actually finished.
      if (pipelineResult.completed && currentTask) {
        const taskId = currentTask.id;

        if (pipelineResult.exitSignal) {
          const count = (this._exitSignalCount.get(taskId) ?? 0) + 1;
          this._exitSignalCount.set(taskId, count);

          if (count >= this._config.exitSignalThreshold) {
            this.markTaskComplete(taskId);
            this.logAgent("system", "task-done",
              `Completed task: ${currentTask.title} (${count} exit signal${count > 1 ? "s" : ""})`);
            this._exitSignalCount.delete(taskId);

            this._handoffContext.add({
              from: agentRole,
              to: AgentRole.Implementer,
              summary: `Completed: ${currentTask.title}`,
              artifacts: filesModified,
              priority: HandoffPriority.Normal,
            });
          } else {
            this.logAgent("system", "awaiting-confirmation",
              `Pipeline passed, ${this._config.exitSignalThreshold - count} more exit signal(s) needed: ${currentTask.title}`);
          }
        } else {
          // Pipeline succeeded but no exit signal — reset consecutive count
          this._exitSignalCount.set(taskId, 0);
          this.logAgent("system", "no-exit-signal",
            `Pipeline passed but no completion signal from Claude: ${currentTask.title}`);
        }
      }

      // Refresh code metrics after files changed
      if (filesModified.length > 0) {
        this.refreshCodeMetrics();
        this.emitDashboardUpdate();
      }

      this.logAgent(
        agentRole,
        pipelineResult.completed ? "completed" : "failed",
        pipelineResult.error ?? `${filesModified.length} files, ${commitsCreated} commits`
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
    // Use a getter so session rotation is picked up mid-iteration
    const getSessionId = () => this._sessionId;
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
        const response = await this.executeWithSessionRotation({
          prompt: `[TDD RED PHASE] Write a failing test for:\n${taskContext}${handoffSection}\n\nWrite ONLY the test. Do NOT implement the feature yet.`,
          systemPrompt: testerPrompt,
          allowedTools: getAgentAllowedTools(AgentRole.Tester, this._config.commands),
          timeout,
          onStderr: this.makeStderrHandler(AgentRole.Tester),
        }, getSessionId);

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
          exitSignal: response.exitSignal,
        };
      },

      executeGreenPhase: async (): Promise<PhaseResult> => {
        this.logAgent(AgentRole.Implementer, "green-phase", "Implementing to pass tests");
        const implPrompt = this._extraSystemContext
          ? `${this._extraSystemContext}\n\n${getAgentPrompt(AgentRole.Implementer)}`
          : getAgentPrompt(AgentRole.Implementer);
        const response = await this.executeWithSessionRotation({
          prompt: `[TDD GREEN PHASE] Implement the MINIMAL code to make the failing test pass:\n${taskContext}${handoffSection}\n\nWrite only enough code to pass the test. Keep it simple.`,
          systemPrompt: implPrompt,
          allowedTools: getAgentAllowedTools(AgentRole.Implementer, this._config.commands),
          timeout,
          onStderr: this.makeStderrHandler(AgentRole.Implementer),
        }, getSessionId);

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
          exitSignal: response.exitSignal,
        };
      },

      executeRefactorPhase: async (): Promise<PhaseResult> => {
        this.logAgent(AgentRole.Implementer, "refactor-phase", "Refactoring");
        const refactorPrompt = this._extraSystemContext
          ? `${this._extraSystemContext}\n\n${getAgentPrompt(AgentRole.Implementer)}`
          : getAgentPrompt(AgentRole.Implementer);
        const response = await this.executeWithSessionRotation({
          prompt: `[TDD REFACTOR PHASE] Improve code quality without changing behavior:\n${taskContext}\n\nAll tests MUST still pass after refactoring.`,
          systemPrompt: refactorPrompt,
          allowedTools: getAgentAllowedTools(AgentRole.Implementer, this._config.commands),
          timeout,
          onStderr: this.makeStderrHandler(AgentRole.Implementer),
        }, getSessionId);

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
          exitSignal: response.exitSignal,
        };
      },

      runSecurityScan: async () => {
        this.logAgent(AgentRole.Security, "scanning", "Running security scan");
        const phaseImpl = await import("./phase-impl.js");
        const result = phaseImpl.scanFilesForSecurity(allFilesModified, this._projectRoot);
        // Update security metrics for dashboard
        const counts: SecurityMetrics = { critical: 0, high: 0, medium: 0, low: 0 };
        for (const f of result.findings) {
          const sev = (f.severity ?? "medium").toLowerCase();
          if (sev === "critical") counts.critical++;
          else if (sev === "high") counts.high++;
          else if (sev === "low") counts.low++;
          else counts.medium++;
        }
        this._securityMetrics = counts;
        this.emitDashboardUpdate();
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
              workspaceType: ws.type,
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
    // Check rate limiter (reset window if elapsed)
    this.rateLimiter.checkWindow();
    if (!this.rateLimiter.canProceed()) {
      return true;
    }
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
    workspaces: NonNullable<ForgeConfig["workspaces"]>
  ): NonNullable<ForgeConfig["workspaces"]> {
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

  /**
   * Execute a Claude call with automatic session rotation on context exhaustion.
   *
   * If the call fails because the session's context window is full,
   * clears the session ID (starting a fresh session) and retries once.
   */
  private async executeWithSessionRotation(
    options: Parameters<ClaudeExecutor["execute"]>[0],
    getSessionId: () => string | undefined
  ): Promise<ClaudeResponse> {
    const response = await this._executor.execute({
      ...options,
      sessionId: getSessionId(),
    });

    // Rotate session on context exhaustion or timeout (large context likely caused the timeout)
    const isTimeout = response.error?.includes("Process timed out");
    if ((response.contextExhausted || isTimeout) && this._sessionId) {
      const reason = response.contextExhausted ? "Context window exhausted" : "Process timed out";
      this.logAgent("system", "session", `${reason} — rotating to fresh session`);
      this._sessionId = undefined;
      return this._executor.execute({
        ...options,
        sessionId: undefined,
      });
    }

    if (response.rateLimited) {
      const waitMs = this._config.rateLimitWaitMinutes * 60 * 1000;
      const until = Date.now() + waitMs;
      this.logAgent("system", "rate-limited",
        `API rate limit hit — waiting ${this._config.rateLimitWaitMinutes} minutes`);
      this._rateLimitWaiting = { until, reason: "API rate limit reached" };
      this.emitDashboardUpdate();

      await this.waitWithCountdown(waitMs);

      this._rateLimitWaiting = undefined;
      this._sessionId = undefined;
      this.emitDashboardUpdate();
      return this._executor.execute({
        ...options,
        sessionId: undefined,
      });
    }

    return response;
  }

  /** Rotate to a fresh Claude session */
  rotateSession(): void {
    this._sessionId = undefined;
  }

  /** Wait with periodic dashboard updates for countdown display */
  private async waitWithCountdown(totalMs: number): Promise<void> {
    const intervalMs = 10_000;
    let remaining = totalMs;
    while (remaining > 0) {
      const sleepTime = Math.min(intervalMs, remaining);
      await new Promise((resolve) => setTimeout(resolve, sleepTime));
      remaining -= sleepTime;
      this.emitDashboardUpdate();
    }
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

  /** Refresh code metrics from the project root (non-fatal on error) */
  private refreshCodeMetrics(): void {
    try {
      const metrics = computeCodeMetrics({ projectRoot: this._projectRoot });
      this._codeMetrics = {
        testRatio: metrics.testRatio,
        sourceFiles: metrics.sourceFiles,
        testFiles: metrics.testFiles,
        averageComplexity: metrics.averageComplexity,
        highComplexityCount: metrics.highComplexityFiles.length,
      };
    } catch {
      // Non-fatal — metrics stay undefined
    }
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
      codeMetrics: this._codeMetrics,
      security: this._securityMetrics,
      rateLimitWaiting: this._rateLimitWaiting,
    });
  }
}
