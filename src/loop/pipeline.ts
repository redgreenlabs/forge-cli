import { TddPhase } from "../tdd/enforcer.js";
import { LoopPhase } from "./engine.js";
import type { PipelineResult } from "../gates/quality-gates.js";

/** Result of a single phase execution */
export interface PhaseResult {
  filesModified: string[];
  testsPass: boolean;
  testResults: { total: number; passed: number; failed: number };
  error: string | null;
  /** Whether Claude signalled explicit completion (EXIT_SIGNAL) */
  exitSignal?: boolean;
}

/** Security scan result */
export interface SecurityScanResult {
  findings: Array<{ severity: string; message: string }>;
  passed: boolean;
}

/** Commit result */
export interface CommitResult {
  committed: boolean;
  message: string;
}

/** Interface for phase execution — implemented by the orchestrator */
export interface PhaseExecutor {
  executeRedPhase: () => Promise<PhaseResult>;
  executeGreenPhase: () => Promise<PhaseResult>;
  executeRefactorPhase: () => Promise<PhaseResult>;
  runSecurityScan: () => Promise<SecurityScanResult>;
  runQualityGates: () => Promise<PipelineResult>;
  executeCommit: (type: string, phase: TddPhase) => Promise<CommitResult>;
  /** Ask Claude to fix quality gate failures, returns the fix result */
  fixQualityIssues?: (report: PipelineResult) => Promise<PhaseResult>;
}

/** Pipeline configuration */
export interface PipelineConfig {
  tddEnabled: boolean;
  securityEnabled: boolean;
  qualityGatesEnabled: boolean;
  autoCommit: boolean;
  /** Max retries for a failed phase (default 0 = no retry) */
  maxPhaseRetries?: number;
  /** Delay between retries in ms (default 1000) */
  retryDelayMs?: number;
  /** Max retries to fix quality gate failures via Claude (default 1) */
  maxGateFixRetries?: number;
}

/** Result of a full pipeline execution */
export interface PipelinePhaseResult {
  completed: boolean;
  error?: string;
  filesModified: string[];
  commitsCreated: number;
  tddPhasesCompleted: TddPhase[];
  securityPassed: boolean;
  gatesPassed: boolean;
  qualityReport?: PipelineResult;
  /** Whether the failure was caused by API rate limiting (should not count as task failure) */
  rateLimited?: boolean;
  /** Whether the failure was caused by a process timeout (skip immediately, don't retry) */
  timedOut?: boolean;
  /** Whether any phase produced an explicit EXIT_SIGNAL from Claude */
  exitSignal: boolean;
}

/**
 * Executes a single iteration's pipeline of phases.
 *
 * Full TDD pipeline:
 *   Red → commit(test) → Green → commit(feat) → Security → Gates → Refactor → commit(refactor)
 *
 * Without TDD:
 *   Green → commit(feat) → Security → Gates
 *
 * Each phase can halt the pipeline on failure.
 */
export class IterationPipeline {
  private config: PipelineConfig;
  private maxRetries: number;
  private retryDelayMs: number;
  private maxGateFixRetries: number;

  constructor(config: PipelineConfig) {
    this.config = config;
    this.maxRetries = config.maxPhaseRetries ?? 0;
    this.retryDelayMs = config.retryDelayMs ?? 1000;
    this.maxGateFixRetries = config.maxGateFixRetries ?? 1;
  }

  async execute(
    executor: PhaseExecutor,
    onPhaseChange: (phase: LoopPhase) => void
  ): Promise<PipelinePhaseResult> {
    const allFiles: string[] = [];
    let commitsCreated = 0;
    const tddPhases: TddPhase[] = [];
    let hasExitSignal = false;

    // === RED PHASE (write failing test) ===
    if (this.config.tddEnabled) {
      onPhaseChange(LoopPhase.Testing);
      const redResult = await this.withRetry(
        () => executor.executeRedPhase(),
        "Red phase"
      );

      if (redResult.error) {
        return this.fail(`Red phase failed: ${redResult.error}`, allFiles, commitsCreated, tddPhases);
      }

      allFiles.push(...redResult.filesModified);
      tddPhases.push(TddPhase.Red);
      if (redResult.exitSignal) hasExitSignal = true;

      // Commit test
      if (this.config.autoCommit) {
        onPhaseChange(LoopPhase.Committing);
        const commitResult = await executor.executeCommit("test", TddPhase.Red);
        if (commitResult.committed) commitsCreated++;
      }
    }

    // === GREEN PHASE (implement to pass tests) ===
    onPhaseChange(LoopPhase.Implementing);
    const greenResult = await this.withRetry(
      () => executor.executeGreenPhase(),
      "Green phase"
    );

    if (greenResult.error) {
      return this.fail(`Green phase failed: ${greenResult.error}`, allFiles, commitsCreated, tddPhases);
    }

    allFiles.push(...greenResult.filesModified);
    tddPhases.push(TddPhase.Green);
    if (greenResult.exitSignal) hasExitSignal = true;

    // Check tests pass after Green — retry the Green phase if tests fail
    if (this.config.tddEnabled && !greenResult.testsPass && this.maxRetries > 0) {
      const retryResult = await this.withRetry(
        () => executor.executeGreenPhase(),
        "Green phase (test fix retry)",
        (r) => r.testsPass
      );
      if (retryResult.testsPass) {
        allFiles.push(...retryResult.filesModified);
      } else {
        return this.fail(
          `Green phase: tests still failing after retries (${retryResult.testResults.failed} failed)`,
          allFiles,
          commitsCreated,
          tddPhases
        );
      }
    } else if (this.config.tddEnabled && !greenResult.testsPass) {
      return this.fail(
        `Green phase: tests still failing (${greenResult.testResults.failed} failed)`,
        allFiles,
        commitsCreated,
        tddPhases
      );
    }

    // Commit implementation
    if (this.config.autoCommit) {
      onPhaseChange(LoopPhase.Committing);
      const commitResult = await executor.executeCommit("feat", TddPhase.Green);
      if (commitResult.committed) commitsCreated++;
    }

    // === SECURITY SCAN ===
    let securityPassed = true;
    if (this.config.securityEnabled) {
      onPhaseChange(LoopPhase.SecurityScan);
      const scanResult = await executor.runSecurityScan();
      securityPassed = scanResult.passed;
    }

    // === QUALITY GATES (with fix-retry loop) ===
    let gatesPassed = true;
    let qualityReport: PipelineResult | undefined;
    if (this.config.qualityGatesEnabled) {
      onPhaseChange(LoopPhase.QualityGate);
      qualityReport = await executor.runQualityGates();
      gatesPassed = qualityReport.passed;

      // When gates fail and a fix executor is available, ask Claude to fix
      // the issues and re-run the gates up to maxGateFixRetries times.
      let fixAttempt = 0;
      while (!gatesPassed && executor.fixQualityIssues && fixAttempt < this.maxGateFixRetries) {
        fixAttempt++;
        onPhaseChange(LoopPhase.Implementing);
        const fixResult = await executor.fixQualityIssues(qualityReport!);

        if (fixResult.error) break; // Claude couldn't attempt a fix

        allFiles.push(...fixResult.filesModified);

        // Commit the fix before re-checking gates
        if (this.config.autoCommit) {
          onPhaseChange(LoopPhase.Committing);
          const commitResult = await executor.executeCommit("fix", TddPhase.Green);
          if (commitResult.committed) commitsCreated++;
        }

        // Re-run quality gates
        onPhaseChange(LoopPhase.QualityGate);
        qualityReport = await executor.runQualityGates();
        gatesPassed = qualityReport.passed;
      }
    }

    if (!gatesPassed) {
      return {
        completed: false,
        error: "Quality gates failed",
        filesModified: allFiles,
        commitsCreated,
        tddPhasesCompleted: tddPhases,
        securityPassed,
        gatesPassed: false,
        qualityReport,
        exitSignal: hasExitSignal,
      };
    }

    // === REFACTOR PHASE ===
    if (this.config.tddEnabled) {
      onPhaseChange(LoopPhase.Implementing);
      const refactorResult = await this.withRetry(
        () => executor.executeRefactorPhase(),
        "Refactor phase"
      );

      if (!refactorResult.error) {
        allFiles.push(...refactorResult.filesModified);
        tddPhases.push(TddPhase.Refactor);

        // Commit refactor
        if (this.config.autoCommit) {
          onPhaseChange(LoopPhase.Committing);
          const commitResult = await executor.executeCommit("refactor", TddPhase.Refactor);
          if (commitResult.committed) commitsCreated++;
        }
      }
    }

    return {
      completed: true,
      filesModified: allFiles,
      commitsCreated,
      tddPhasesCompleted: tddPhases,
      securityPassed,
      gatesPassed,
      qualityReport,
      exitSignal: hasExitSignal,
    };
  }

  /**
   * Execute a phase function with retry on transient errors.
   *
   * Retries when:
   * - The phase throws an exception (timeout, process crash)
   * - An optional successCheck returns false (e.g. tests still failing)
   *
   * Returns the last result on exhaustion (does not throw).
   */
  private async withRetry(
    fn: () => Promise<PhaseResult>,
    phaseName: string,
    successCheck?: (result: PhaseResult) => boolean
  ): Promise<PhaseResult> {
    let lastResult: PhaseResult | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await fn();
        lastResult = result;

        // If no success check or it passes, return immediately
        if (!successCheck || successCheck(result)) {
          return result;
        }

        // Success check failed — retry if attempts remain
        if (attempt < this.maxRetries && this.retryDelayMs > 0) {
          await sleep(this.retryDelayMs);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastResult = {
          filesModified: [],
          testsPass: false,
          testResults: { total: 0, passed: 0, failed: 0 },
          error: `${phaseName} threw: ${message}`,
        };

        // Retry if attempts remain
        if (attempt < this.maxRetries && this.retryDelayMs > 0) {
          await sleep(this.retryDelayMs);
        }
      }
    }

    return lastResult!;
  }

  private fail(
    error: string,
    filesModified: string[],
    commitsCreated: number,
    tddPhases: TddPhase[]
  ): PipelinePhaseResult {
    return {
      completed: false,
      error,
      filesModified,
      commitsCreated,
      tddPhasesCompleted: tddPhases,
      securityPassed: true,
      gatesPassed: true,
      exitSignal: false,
      rateLimited: error.includes("rate limit") || error.includes("rate_limit"),
      timedOut: error.includes("timed out") || error.includes("exit code 143"),
    };
  }
}

/** Simple async delay */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
