import { QualityGateSeverity } from "../config/schema.js";

/** Status of a single quality gate check */
export enum GateStatus {
  Passed = "passed",
  Failed = "failed",
  Warning = "warning",
  Error = "error",
  Skipped = "skipped",
}

/** Result of a gate check function */
export interface GateCheckResult {
  passed: boolean;
  message: string;
  details?: Record<string, unknown>;
}

/** Definition of a quality gate */
export interface QualityGateDefinition {
  name: string;
  severity: QualityGateSeverity;
  check: () => Promise<GateCheckResult>;
}

/** Result of running a single quality gate */
export interface GateResult {
  name: string;
  status: GateStatus;
  message: string;
  durationMs: number;
  details?: Record<string, unknown>;
}

/** Summary counts for a pipeline run */
export interface PipelineSummary {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
  errors: number;
}

/** Result of running the full quality gate pipeline */
export interface PipelineResult {
  passed: boolean;
  results: GateResult[];
  summary: PipelineSummary;
  totalDurationMs: number;
}

/**
 * Quality gate pipeline that runs a sequence of checks and determines
 * whether the iteration should proceed.
 *
 * Gates with severity "block" cause the pipeline to fail.
 * Gates with severity "warn" emit warnings but allow continuation.
 * Gates that throw errors are treated as failures.
 */
export class QualityGatePipeline {
  constructor(private gates: QualityGateDefinition[]) {}

  /** Run all gates and return the combined result */
  async run(): Promise<PipelineResult> {
    const pipelineStart = Date.now();
    const results: GateResult[] = [];

    for (const gate of this.gates) {
      const start = Date.now();
      let result: GateResult;

      try {
        const checkResult = await gate.check();
        const durationMs = Date.now() - start;

        if (checkResult.passed) {
          result = {
            name: gate.name,
            status: GateStatus.Passed,
            message: checkResult.message,
            durationMs,
            details: checkResult.details,
          };
        } else {
          result = {
            name: gate.name,
            status:
              gate.severity === QualityGateSeverity.Block
                ? GateStatus.Failed
                : GateStatus.Warning,
            message: checkResult.message,
            durationMs,
            details: checkResult.details,
          };
        }
      } catch (error) {
        const durationMs = Date.now() - start;
        result = {
          name: gate.name,
          status: GateStatus.Error,
          message:
            error instanceof Error ? error.message : "Unknown gate error",
          durationMs,
        };
      }

      results.push(result);
    }

    const totalDurationMs = Date.now() - pipelineStart;

    const summary: PipelineSummary = {
      total: results.length,
      passed: results.filter((r) => r.status === GateStatus.Passed).length,
      failed: results.filter((r) => r.status === GateStatus.Failed).length,
      warnings: results.filter((r) => r.status === GateStatus.Warning).length,
      errors: results.filter((r) => r.status === GateStatus.Error).length,
    };

    const hasBlockingFailure = results.some(
      (r) => r.status === GateStatus.Failed || r.status === GateStatus.Error
    );

    return {
      passed: !hasBlockingFailure,
      results,
      summary,
      totalDurationMs,
    };
  }
}
