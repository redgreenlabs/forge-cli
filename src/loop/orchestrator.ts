import type { ForgeConfig } from "../config/schema.js";
import { AgentRole } from "../config/schema.js";
import {
  selectAgentForTask,
  getTddSystemPrompt,
  getTddAllowedTools,
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
import type { AgentLogEntry, CodeQualityMetrics, CoverageMetrics, SecurityMetrics, CostMetrics } from "../tui/renderer.js";
import { HandoffContext, HandoffPriority } from "../agents/handoff.js";
import { TeamComposer } from "../agents/team.js";
import type { WarningPanelData } from "../tui/error-panel.js";
import {
  IterationPipeline,
  type PhaseExecutor,
  type PhaseResult,
} from "./pipeline.js";
import { RateLimiter } from "./rate-limiter.js";
import { TaskManifest } from "./task-manifest.js";
import { computeCodeMetrics } from "../metrics/code-metrics.js";
import {
  getHeadSha,
  detectFilesFromCommits,
  countCommitsBetween,
  type StreamEvent,
} from "./executor.js";

/** Claude Code execution interface */
export interface ClaudeExecutor {
  execute: (options: {
    prompt: string;
    systemPrompt: string;
    allowedTools: string[];
    timeout: number;
    sessionId?: string;
    maxTurns?: number;
    onStderr?: (line: string) => void;
    onStreamEvent?: (event: StreamEvent) => void;
    signal?: AbortSignal;
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
  /** Unix timestamp (seconds) when the rate limit resets */
  rateLimitResetsAt?: number;
  /** Raw stderr output from Claude CLI (preserved for timeout diagnostics) */
  rawStderr?: string;
  /** Raw stdout output from Claude CLI (preserved for timeout diagnostics) */
  rawStdout?: string;
  /** Claude session ID from stream events (for session continuity) */
  sessionId?: string;
}

/** User's decision when a task fails repeatedly */
export type TaskFailureAction =
  | { action: "retry"; guidance: string }
  | { action: "defer" }
  | { action: "skip" }
  | { action: "abort" };

/** Callback invoked when a task reaches maxTaskFailures */
export type OnTaskFailure = (task: {
  id: string;
  title: string;
  failCount: number;
  lastError: string | null;
}) => Promise<TaskFailureAction>;

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
  /** Callback for human-in-the-loop on task failure (if not set, auto-skips) */
  onTaskFailure?: OnTaskFailure;
  /** Expedite mode — skip TDD, security, quality gates for fast prototyping */
  expedite?: boolean;
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
  /** Raw Claude CLI output lines for live log pane */
  claudeLogs: string[];
  /** Accumulated cost metrics */
  cost?: CostMetrics;
  /** Expedite mode — no tests, no gates, prototype only */
  expedite?: boolean;
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
  private _taskFailureCounts = new Map<string, number>();
  private _claudeLogs: string[] = [];
  private _signal?: AbortSignal;
  private static readonly MAX_CLAUDE_LOGS = 200;
  private _costTotal = 0;
  private _costCurrentTask = 0;
  private _costPerPhase: Record<string, number> = {};
  private _executionCount = 0;
  private _taskManifest: TaskManifest;
  private _onTaskFailure?: OnTaskFailure;
  private _taskGuidance = new Map<string, string>();
  private _userAborted = false;
  private _expedite: boolean;

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
    this._taskManifest = TaskManifest.load(this._projectRoot);
    this._onTaskFailure = options.onTaskFailure;
    this._expedite = options.expedite ?? false;

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
      this._costCurrentTask = 0;
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
        tddEnabled: this._expedite ? false : this._config.tdd.enabled,
        securityEnabled: this._expedite ? false : this._config.security.enabled,
        qualityGatesEnabled: !this._expedite,
        autoCommit: this._config.tdd.commitPerPhase,
        maxPhaseRetries: this._config.retry.maxPhaseRetries,
        retryDelayMs: this._config.retry.retryDelayMs,
        maxGateFixRetries: this._config.retry.maxPhaseRetries ?? 1,
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
        error: pipelineResult.rateLimited ? null : (pipelineResult.error ?? null),
        testsPass: pipelineResult.rateLimited ? true : pipelineResult.gatesPassed,
      });
      this.engine.setCircuitBreakerState(this.circuitBreaker.state);

      // Update quality report
      if (pipelineResult.qualityReport) {
        this._qualityReport = pipelineResult.qualityReport;
      }

      // Complete the TDD cycle when all 3 phases ran successfully
      const hasFullCycle = pipelineResult.tddPhasesCompleted.length === 3
        && pipelineResult.tddPhasesCompleted.includes(TddPhase.Red)
        && pipelineResult.tddPhasesCompleted.includes(TddPhase.Green)
        && pipelineResult.tddPhasesCompleted.includes(TddPhase.Refactor);
      if (hasFullCycle) {
        this.tddEnforcer.completeCycle();
      }

      // Mark task complete when the pipeline succeeds.
      // A successful TDD cycle (test + implementation + refactor + quality gates)
      // IS the completion signal — no need for a separate exit signal from Claude.
      if (pipelineResult.completed && currentTask) {
        this.markTaskComplete(currentTask.id);
        this.logAgent("system", "task-done",
          `Completed task: ${currentTask.title}`);

        this._handoffContext.add({
          from: agentRole,
          to: AgentRole.Implementer,
          summary: `Completed: ${currentTask.title}`,
          artifacts: filesModified,
          priority: HandoffPriority.Normal,
        });
      }

      // Refresh code metrics after files changed
      if (filesModified.length > 0) {
        this.refreshCodeMetrics();
        this.emitDashboardUpdate();
      }

      // Track per-task failures and skip after maxTaskFailures consecutive failures
      // Rate-limited failures are not the task's fault — don't count them
      if (!pipelineResult.completed && currentTask && !pipelineResult.rateLimited) {
        // Timeouts skip immediately — a hanging test won't fix itself on retry
        if (pipelineResult.timedOut) {
          this.taskGraph.markSkipped(currentTask.id);
          this.logAgent("system", "task-skipped",
            `Skipping task after timeout (won't retry): ${currentTask.title}`);
          this.logAgent("system", "timeout-diagnostics",
            `Task "${currentTask.title}" timed out. The test command likely hangs — check if a device/emulator is required or increase timeoutMinutes.`);
          this._taskFailureCounts.delete(currentTask.id);
        } else {
          const failCount = (this._taskFailureCounts.get(currentTask.id) ?? 0) + 1;
          this._taskFailureCounts.set(currentTask.id, failCount);

          if (failCount >= this._config.maxTaskFailures) {
            await this.handleTaskMaxFailures(currentTask, failCount, pipelineResult.error ?? null);
          } else {
            this.logAgent("system", "task-retry",
              `Failure ${failCount}/${this._config.maxTaskFailures} for: ${currentTask.title}`);
          }
        }
      } else if (pipelineResult.completed && currentTask) {
        // Reset failure count on success
        this._taskFailureCounts.delete(currentTask.id);
      }

      this.logAgent(
        agentRole,
        pipelineResult.completed ? "completed" : "failed",
        pipelineResult.error ?? `${filesModified.length} files, ${commitsCreated} commits`
      );

      // Record task-file mapping for commit reconstruction
      if (currentTask && filesModified.length > 0) {
        for (const phase of pipelineResult.tddPhasesCompleted) {
          this._taskManifest.record(currentTask.id, currentTask.title, phase, filesModified);
          if (commitsCreated > 0) {
            this._taskManifest.markCommitted(currentTask.id, phase);
          }
        }
        try { this._taskManifest.save(this._projectRoot); } catch { /* non-fatal */ }
      }
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
    const guidance = this._taskGuidance.get(task.id);
    const guidanceSection = guidance ? `\n\nUser guidance from previous failure:\n${guidance}` : "";
    const taskContext = `Task: ${task.title}\nAcceptance criteria: ${(task as TaskNode & { acceptanceCriteria?: string[] }).acceptanceCriteria?.join(", ") ?? ""}${guidanceSection}`;
    const handoffSection = handoffPrompt ? `\n\n${handoffPrompt}` : "";

    // Unified TDD prompt and tools — stays constant across --continue calls
    // so Claude keeps full context (read files, test results) from previous phases.
    const tddSystemPrompt = this._extraSystemContext
      ? `${this._extraSystemContext}\n\n${getTddSystemPrompt()}`
      : getTddSystemPrompt();
    const tddTools = getTddAllowedTools(this._config.commands);

    // Accumulates files modified across all phases for security scan and commits
    const allFilesModified: string[] = [];

    // Session ID captured from the red phase and reused for green/refactor.
    // This keeps files read during the red phase in Claude's context window,
    // avoiding redundant reads and saving tokens.
    let taskSessionId: string | undefined;

    return {
      executeRedPhase: async (): Promise<PhaseResult> => {
        this.logAgent(AgentRole.Tester, "red-phase", "Writing failing test");
        const { stderrHandler, streamHandler } = this.makeHandlers(AgentRole.Tester);
        // Start a fresh session for each task (don't reuse cross-task sessions)
        const response = await this.executeWithSessionRotation({
          prompt: `[TDD RED PHASE] Write a failing test for:\n${taskContext}${handoffSection}\n\nRULES:\n- Write ONLY tests that verify the acceptance criteria above\n- Test functional behavior (inputs, outputs, user interactions), NOT project structure or meta-checks\n- Write ONE test file with focused test cases — do not create multiple test files\n- Each test must fail because the feature code doesn't exist yet, not because of missing config\n- Do NOT implement the feature yet`,
          systemPrompt: tddSystemPrompt,
          allowedTools: tddTools,
          timeout,
          maxTurns: 25,
          onStderr: stderrHandler,
          onStreamEvent: streamHandler,
        }, getSessionId);

        // Capture session ID for subsequent phases
        if (response.sessionId) {
          taskSessionId = response.sessionId;
        }

        if (response.testResults) {
          this.tddEnforcer.recordTestRun(response.testResults);
          if (response.testResults.failed > 0) {
            this._testFailures = response.testResults.failed;
          }
        }
        // Ensure dashboard advances to Green even if test results weren't parseable
        this.tddEnforcer.advanceToPhase(TddPhase.Green);
        this.emitDashboardUpdate();

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
        this.logAgent(AgentRole.Implementer, "green-phase",
          this._expedite ? "Implementing (expedite)" : "Implementing to pass tests");
        const { stderrHandler: implStderr, streamHandler: implStream } = this.makeHandlers(AgentRole.Implementer);
        // Continue the session from the red phase so Claude already has test files in context
        const greenSessionId = taskSessionId ?? getSessionId();
        const greenPrompt = this._expedite
          ? `[EXPEDITE] Implement this feature quickly:\n${taskContext}${handoffSection}\n\nFocus on working code. Skip tests. Ship fast.`
          : `[TDD GREEN PHASE] Implement the MINIMAL code to make the failing test pass:\n${taskContext}${handoffSection}\n\nWrite only enough code to pass the test. Keep it simple.`;
        const response = await this.executeWithSessionRotation({
          prompt: greenPrompt,
          systemPrompt: tddSystemPrompt,
          allowedTools: tddTools,
          timeout,
          maxTurns: 25,
          onStderr: implStderr,
          onStreamEvent: implStream,
        }, () => greenSessionId);

        // Update session ID in case it was rotated
        if (response.sessionId) {
          taskSessionId = response.sessionId;
        }

        if (response.testResults) {
          this.tddEnforcer.recordTestRun(response.testResults);
          if (response.testResults.failed > 0) {
            this._testFailures = response.testResults.failed;
          }
        }
        // Ensure dashboard advances to Refactor even if test results weren't parseable
        this.tddEnforcer.advanceToPhase(TddPhase.Refactor);
        this.emitDashboardUpdate();

        // Log timeout diagnostics for visibility
        if (response.error?.includes("timed out") && response.rawStderr) {
          this.logAgent("system", "timeout-stderr",
            response.rawStderr.slice(-500));
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
        const { stderrHandler: refStderr, streamHandler: refStream } = this.makeHandlers(AgentRole.Implementer);
        // Continue the session from green phase — test + impl files already in context
        const refactorSessionId = taskSessionId ?? getSessionId();
        const response = await this.executeWithSessionRotation({
          prompt: `[TDD REFACTOR PHASE] Improve code quality without changing behavior:\n${taskContext}\n\nAll tests MUST still pass after refactoring.`,
          systemPrompt: tddSystemPrompt,
          allowedTools: tddTools,
          timeout,
          maxTurns: 15,
          onStderr: refStderr,
          onStreamEvent: refStream,
        }, () => refactorSessionId);

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

      fixQualityIssues: async (report: PipelineResult): Promise<PhaseResult> => {
        const failedGates = report.results
          .filter((r) => r.status === "failed" || r.status === "error")
          .map((r) => `- ${r.name}: ${r.message}`)
          .join("\n");
        this.logAgent(AgentRole.Implementer, "fix-gates", `Fixing ${report.summary.failed + report.summary.errors} gate failures`);
        const { stderrHandler, streamHandler } = this.makeHandlers(AgentRole.Implementer);
        const fixSessionId = taskSessionId ?? getSessionId();
        const response = await this.executeWithSessionRotation({
          prompt: `[FIX QUALITY GATES] The following quality gates failed after implementation:\n\n${failedGates}\n\nContext: ${taskContext}\n\nFix these issues. Run the failing commands to verify your fixes work. Do NOT skip or disable checks — fix the underlying code issues.`,
          systemPrompt: tddSystemPrompt,
          allowedTools: tddTools,
          timeout,
          maxTurns: 15,
          onStderr: stderrHandler,
          onStreamEvent: streamHandler,
        }, () => fixSessionId);

        if (response.sessionId) {
          taskSessionId = response.sessionId;
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

      executeCommit: async (_type: string, phase: TddPhase) => {
        this.logAgent("system", "commit", `${phase} phase`);
        const phaseImpl = await import("./phase-impl.js");
        const result = await phaseImpl.commitPhase(
          phase,
          allFilesModified,
          task.title,
          this._projectRoot,
          task.id
        );
        if (!result.committed) {
          this.logAgent("system", "commit-failed",
            `Commit failed for ${phase} phase: ${result.message}`);
        }
        return result;
      },
    };
  }

  /** Run the full loop until a stop condition is met */
  async runLoop(signal?: AbortSignal): Promise<void> {
    this._signal = signal;

    // On resume: recover uncommitted work from a previous interrupted session.
    // Only commit tasks where all 3 TDD phases completed (red+green+refactor).
    // Partially completed tasks are left for the pipeline to resume naturally:
    //   - Red only → pipeline will run Green next (test file already exists)
    //   - Red+Green → pipeline will run Refactor next
    const pendingEntries = this._taskManifest.uncommitted();
    if (pendingEntries.length > 0) {
      // Group by taskId to check completeness
      const byTask = new Map<string, Set<string>>();
      for (const entry of pendingEntries) {
        const phases = byTask.get(entry.taskId) ?? new Set();
        phases.add(entry.phase);
        byTask.set(entry.taskId, phases);
      }

      const completeTasks = [...byTask.entries()]
        .filter(([, phases]) => phases.has("green")) // At minimum, implementation was done
        .map(([id]) => id);

      const partialTasks = [...byTask.entries()]
        .filter(([, phases]) => !phases.has("green"))
        .map(([id]) => id);

      if (completeTasks.length > 0) {
        this.logAgent("system", "recovery",
          `Committing ${completeTasks.length} completed tasks from previous session`);
        const { committed } = await this._taskManifest.commitUncommitted(this._projectRoot);
        if (committed > 0) {
          this.logAgent("system", "recovery", `Recovered ${committed} commits`);
          this._committedCount += committed;
        }
      }

      if (partialTasks.length > 0) {
        this.logAgent("system", "recovery",
          `${partialTasks.length} partial tasks will resume from where they left off`);
      }

      this.emitDashboardUpdate();
    }

    while (!this.shouldStop()) {
      if (signal?.aborted || this._userAborted) {
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

  /**
   * Handle a task that has reached maxTaskFailures.
   * If onTaskFailure is set (interactive mode), prompt the user.
   * Otherwise, skip permanently (headless fallback).
   */
  private async handleTaskMaxFailures(
    task: TaskNode,
    failCount: number,
    lastError: string | null
  ): Promise<void> {
    // Clear stale rate limit modal before showing task failure prompt
    if (this._rateLimitWaiting) {
      this._rateLimitWaiting = undefined;
      this.emitDashboardUpdate();
    }
    if (this._onTaskFailure) {
      const decision = await this._onTaskFailure({
        id: task.id,
        title: task.title,
        failCount,
        lastError,
      });
      switch (decision.action) {
        case "retry":
          this._taskGuidance.set(task.id, decision.guidance);
          this._taskFailureCounts.set(task.id, 0);
          this.logAgent("system", "task-retry-guided",
            `User provided guidance for: ${task.title}`);
          break;
        case "defer":
          this.taskGraph.markDeferred(task.id);
          this._taskFailureCounts.delete(task.id);
          this.logAgent("system", "task-deferred",
            `Deferred to later: ${task.title}`);
          break;
        case "skip":
          this.taskGraph.markSkipped(task.id);
          this._taskFailureCounts.delete(task.id);
          this.logAgent("system", "task-skipped",
            `Permanently skipped: ${task.title}`);
          break;
        case "abort":
          this._userAborted = true;
          this.logAgent("system", "user-abort", "User aborted session");
          break;
      }
      // User made a conscious decision — reset circuit breaker so the loop
      // continues with the next task instead of stopping from stale failures
      if (decision.action !== "abort") {
        this.circuitBreaker.reset();
        this.engine.setCircuitBreakerState(this.circuitBreaker.state);
      }
    } else {
      // Headless: auto-skip
      this.taskGraph.markSkipped(task.id);
      this.logAgent("system", "task-skipped",
        `Skipping task after ${failCount} consecutive failures: ${task.title}`);
      this._taskFailureCounts.delete(task.id);
    }
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
      signal: this._signal,
    });

    // Rotate session only on context exhaustion — timeouts are often caused by
    // hanging tests, not context size, and rotation wastes tokens re-reading files
    if (response.contextExhausted && this._sessionId) {
      this.logAgent("system", "session", "Context window exhausted — rotating to fresh session");
      this._sessionId = undefined;
      return this._executor.execute({
        ...options,
        sessionId: undefined,
        signal: this._signal,
      });
    }

    if (response.rateLimited) {
      // Use resetsAt from API if available, otherwise fall back to config
      let waitMs: number;
      let until: number;
      if (response.rateLimitResetsAt) {
        until = response.rateLimitResetsAt * 1000; // Convert seconds to ms
        waitMs = Math.max(0, until - Date.now());
        // Enforce minimum 60s wait to prevent retry storms when resetsAt is stale
        // (unless rateLimitWaitMinutes is explicitly 0, e.g. in tests)
        const minWaitMs = this._config.rateLimitWaitMinutes > 0 ? 60_000 : 0;
        if (waitMs < minWaitMs) waitMs = minWaitMs;
        const waitMin = Math.ceil(waitMs / 60_000);
        this.logAgent("system", "rate-limited",
          `API rate limit hit — waiting ${waitMin} minutes (resets at ${new Date(until).toLocaleTimeString()})`);
      } else {
        waitMs = this._config.rateLimitWaitMinutes * 60 * 1000;
        until = Date.now() + waitMs;
        this.logAgent("system", "rate-limited",
          `API rate limit hit — waiting ${this._config.rateLimitWaitMinutes} minutes`);
      }
      this._rateLimitWaiting = { until: Date.now() + waitMs, reason: "API rate limit reached" };
      this.emitDashboardUpdate();

      await this.waitWithCountdown(waitMs);

      this._rateLimitWaiting = undefined;
      this._sessionId = undefined;
      this.emitDashboardUpdate();

      // If aborted during countdown, return immediately — don't retry
      if (this._signal?.aborted || this._userAborted) {
        return response;
      }

      // Single retry after waiting — if still rate-limited, return the error
      // to avoid infinite retry storms
      const retryResponse = await this._executor.execute({
        ...options,
        sessionId: undefined,
        signal: this._signal,
      });
      if (retryResponse.rateLimited) {
        this.logAgent("system", "rate-limited",
          "Still rate-limited after waiting — will retry on next iteration");
      }
      return retryResponse;
    }

    return response;
  }

  /** Rotate to a fresh Claude session */
  rotateSession(): void {
    this._sessionId = undefined;
  }

  /** Wait with periodic dashboard updates for countdown display */
  private async waitWithCountdown(totalMs: number): Promise<void> {
    const intervalMs = 1_000; // Check abort signal every second for responsive quit
    let remaining = totalMs;
    let dashboardTick = 0;
    while (remaining > 0) {
      if (this._signal?.aborted || this._userAborted) {
        this._rateLimitWaiting = undefined;
        this.emitDashboardUpdate();
        return;
      }
      const sleepTime = Math.min(intervalMs, remaining);
      await new Promise((resolve) => setTimeout(resolve, sleepTime));
      remaining -= sleepTime;
      dashboardTick++;
      // Update dashboard every 10 ticks (10s) to avoid excessive re-renders
      if (dashboardTick % 10 === 0) {
        this.emitDashboardUpdate();
      }
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
   * Create stderr + stream event handlers for a phase execution.
   *
   * The stream handler parses rich JSON events from Claude CLI's
   * stream-json output for the log pane and agent activity.
   * The stderr handler is a fallback for non-JSON output.
   */
  private makeHandlers(agentRole: string): {
    stderrHandler: (line: string) => void;
    streamHandler: (event: StreamEvent) => void;
  } {
    let lastLogTime = 0;
    const THROTTLE_MS = 500;

    const pushClaudeLog = (line: string) => {
      if (!line) return;
      this._claudeLogs.push(line);
      if (this._claudeLogs.length > LoopOrchestrator.MAX_CLAUDE_LOGS) {
        this._claudeLogs.splice(0, this._claudeLogs.length - LoopOrchestrator.MAX_CLAUDE_LOGS);
      }
    };

    const stderrHandler = (line: string) => {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        pushClaudeLog(trimmed);
      }

      const now = Date.now();
      if (now - lastLogTime < THROTTLE_MS) return;

      // Stderr patterns (fallback — most info now comes via stream events)
      if (trimmed.length > 5 && now - lastLogTime >= 3000) {
        lastLogTime = now;
        this._agentLog.push({
          timestamp: now,
          agent: agentRole,
          action: "working",
          detail: trimmed.slice(0, 60),
        });
        this.emitDashboardUpdate();
      }
    };

    const streamHandler = (event: StreamEvent) => {
      const now = Date.now();

      if (event.type === "assistant" && event.message?.content) {
        for (const block of event.message.content) {
          // Tool usage
          if (block.type === "tool_use" && block.name) {
            const filePath = (block.input?.file_path as string) ?? "";
            const command = (block.input?.command as string) ?? "";
            const detail = filePath
              ? `${block.name}(${filePath.split("/").pop()})`
              : command
                ? `${block.name}: ${command.slice(0, 50)}`
                : block.name;
            pushClaudeLog(`⚡ ${detail}`);
            if (now - lastLogTime >= THROTTLE_MS) {
              lastLogTime = now;
              this._agentLog.push({
                timestamp: now,
                agent: agentRole,
                action: "tool",
                detail,
              });
              this.emitDashboardUpdate();
            }
          }
          // Text output
          if (block.type === "text" && block.text) {
            // Push first ~120 chars of text as a log line
            const preview = block.text.replace(/\n/g, " ").slice(0, 120);
            if (preview.length > 3) {
              pushClaudeLog(preview);
            }
          }
        }
      }

      // Result event — log cost and accumulate totals
      if (event.type === "result") {
        // Execution completed — clear any stale rate limit modal from stream events
        if (this._rateLimitWaiting) {
          this._rateLimitWaiting = undefined;
        }
      }
      if (event.type === "result" && event.total_cost_usd) {
        const cost = event.total_cost_usd;
        const costLine = `✓ Done — $${cost.toFixed(4)} (${event.duration_ms ?? 0}ms)`;
        pushClaudeLog(costLine);
        lastLogTime = now;

        // Accumulate cost metrics
        this._costTotal += cost;
        this._costCurrentTask += cost;
        this._executionCount++;
        const phase = this.engine.state.phase;
        this._costPerPhase[phase] = (this._costPerPhase[phase] ?? 0) + cost;

        this._agentLog.push({
          timestamp: now,
          agent: "system",
          action: "cost",
          detail: `$${cost.toFixed(4)} (total: $${this._costTotal.toFixed(4)})`,
        });
        this.emitDashboardUpdate();
      }

      // Rate limit event — show modal immediately
      if (event.type === "rate_limit_event") {
        try {
          const parsed = JSON.parse(event.raw);
          const info = parsed.rate_limit_info;
          if (info?.status === "rejected" && info.resetsAt) {
            const until = info.resetsAt * 1000;
            this._rateLimitWaiting = { until, reason: "API rate limit reached" };
            pushClaudeLog(`⏳ Rate limited — resets at ${new Date(until).toLocaleTimeString()}`);
          } else if (info?.status === "allowed_warning" && info.utilization) {
            const pct = Math.round(info.utilization * 100);
            pushClaudeLog(`⚠ API usage at ${pct}% — approaching rate limit`);
          }
        } catch { /* ignore parse error */ }
        this.emitDashboardUpdate();
      }

      // Always emit update so log pane refreshes
      if (this._claudeLogs.length > 0) {
        this.emitDashboardUpdate();
      }
    };

    return { stderrHandler, streamHandler };
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
      claudeLogs: this._claudeLogs,
      cost: this._executionCount > 0 ? {
        totalUsd: this._costTotal,
        currentTaskUsd: this._costCurrentTask,
        perPhase: { ...this._costPerPhase },
        executions: this._executionCount,
        completedTasks: this.engine.state.tasksCompleted,
      } : undefined,
      expedite: this._expedite || undefined,
    });
  }
}
