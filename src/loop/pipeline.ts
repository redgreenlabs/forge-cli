import { TddPhase } from "../tdd/enforcer.js";
import { LoopPhase } from "./engine.js";
import type { PipelineResult } from "../gates/quality-gates.js";

/** Result of a single phase execution */
export interface PhaseResult {
  filesModified: string[];
  testsPass: boolean;
  testResults: { total: number; passed: number; failed: number };
  error: string | null;
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
}

/** Pipeline configuration */
export interface PipelineConfig {
  tddEnabled: boolean;
  securityEnabled: boolean;
  qualityGatesEnabled: boolean;
  autoCommit: boolean;
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

  constructor(config: PipelineConfig) {
    this.config = config;
  }

  async execute(
    executor: PhaseExecutor,
    onPhaseChange: (phase: LoopPhase) => void
  ): Promise<PipelinePhaseResult> {
    const allFiles: string[] = [];
    let commitsCreated = 0;
    const tddPhases: TddPhase[] = [];

    // === RED PHASE (write failing test) ===
    if (this.config.tddEnabled) {
      onPhaseChange(LoopPhase.Testing);
      const redResult = await executor.executeRedPhase();

      if (redResult.error) {
        return this.fail(`Red phase failed: ${redResult.error}`, allFiles, commitsCreated, tddPhases);
      }

      allFiles.push(...redResult.filesModified);
      tddPhases.push(TddPhase.Red);

      // Commit test
      if (this.config.autoCommit) {
        onPhaseChange(LoopPhase.Committing);
        const commitResult = await executor.executeCommit("test", TddPhase.Red);
        if (commitResult.committed) commitsCreated++;
      }
    }

    // === GREEN PHASE (implement to pass tests) ===
    onPhaseChange(LoopPhase.Implementing);
    const greenResult = await executor.executeGreenPhase();

    if (greenResult.error) {
      return this.fail(`Green phase failed: ${greenResult.error}`, allFiles, commitsCreated, tddPhases);
    }

    allFiles.push(...greenResult.filesModified);
    tddPhases.push(TddPhase.Green);

    // Check tests pass after Green
    if (this.config.tddEnabled && !greenResult.testsPass) {
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

    // === QUALITY GATES ===
    let gatesPassed = true;
    let qualityReport: PipelineResult | undefined;
    if (this.config.qualityGatesEnabled) {
      onPhaseChange(LoopPhase.QualityGate);
      qualityReport = await executor.runQualityGates();
      gatesPassed = qualityReport.passed;
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
      };
    }

    // === REFACTOR PHASE ===
    if (this.config.tddEnabled) {
      onPhaseChange(LoopPhase.Implementing);
      const refactorResult = await executor.executeRefactorPhase();

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
    };
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
    };
  }
}
