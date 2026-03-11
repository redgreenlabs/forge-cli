import { QualityGateSeverity } from "../config/schema.js";
import type { GatePlugin } from "./plugin.js";
import { parseNpmAudit, parsePipAudit, parseCargoAudit } from "../security/dep-audit.js";

/** Supported package managers for dep audit */
export type PackageManager = "npm" | "pip" | "cargo";

/** Options for the dependency audit gate */
export interface DepAuditGateOptions {
  projectRoot: string;
  packageManager: PackageManager;
  blockOnSeverity: string;
}

const AUDIT_COMMANDS: Record<PackageManager, string> = {
  npm: "npm audit --json",
  pip: "pip-audit --format=json",
  cargo: "cargo audit --json",
};

const PARSERS: Record<PackageManager, (output: string) => { shouldBlock: (threshold: string) => boolean; vulnerabilities: { length: number }; error?: string }> = {
  npm: parseNpmAudit,
  pip: parsePipAudit,
  cargo: parseCargoAudit,
};

/**
 * Create a quality gate plugin that runs dependency audit.
 *
 * Supports npm, pip-audit, and cargo-audit. Parses JSON output
 * and blocks based on severity threshold.
 */
export function createDepAuditGate(options: DepAuditGateOptions): GatePlugin {
  return {
    name: "dependency-audit",
    description: `Run ${options.packageManager} dependency audit`,
    severity: QualityGateSeverity.Block,
    check: async () => {
      try {
        const { execSync } = await import("child_process");
        const command = AUDIT_COMMANDS[options.packageManager];
        let output: string;

        try {
          output = execSync(command, {
            cwd: options.projectRoot,
            stdio: "pipe",
            encoding: "utf-8",
            timeout: 60_000,
          });
        } catch (err) {
          // npm audit exits with non-zero when vulns found but still outputs JSON
          const execErr = err as { stdout?: string; message?: string };
          if (execErr.stdout) {
            output = execErr.stdout;
          } else {
            return {
              passed: false,
              message: execErr.message ?? `${options.packageManager} audit failed`,
            };
          }
        }

        const parser = PARSERS[options.packageManager];
        const result = parser(output);

        if (result.error) {
          return { passed: false, message: result.error };
        }

        if (result.shouldBlock(options.blockOnSeverity)) {
          return {
            passed: false,
            message: `${result.vulnerabilities.length} vulnerabilities found (blocking on ${options.blockOnSeverity}+)`,
          };
        }

        return {
          passed: true,
          message: result.vulnerabilities.length > 0
            ? `${result.vulnerabilities.length} vulnerabilities (below threshold)`
            : "No vulnerabilities found",
        };
      } catch (err) {
        return {
          passed: false,
          message: err instanceof Error ? err.message : "Audit failed",
        };
      }
    },
  };
}
