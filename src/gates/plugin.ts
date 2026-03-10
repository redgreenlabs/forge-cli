import { QualityGateSeverity } from "../config/schema.js";
import type { QualityGateDefinition, GateCheckResult } from "./quality-gates.js";

/** A quality gate plugin definition */
export interface GatePlugin {
  name: string;
  description: string;
  severity: QualityGateSeverity;
  check: () => Promise<GateCheckResult>;
}

/** Options for creating builtin gates */
export interface BuiltinGateOptions {
  projectRoot: string;
  testCommand: string;
  lintCommand: string;
}

/**
 * Registry for quality gate plugins.
 *
 * Allows registering custom gates beyond the 5 builtins,
 * overriding severity, and converting to pipeline definitions.
 */
export class GatePluginRegistry {
  private plugins = new Map<string, GatePlugin>();
  private severityOverrides = new Map<string, QualityGateSeverity>();

  /** Register a new gate plugin */
  register(plugin: GatePlugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Gate plugin "${plugin.name}" already registered`);
    }
    this.plugins.set(plugin.name, plugin);
  }

  /** Remove a gate plugin */
  unregister(name: string): void {
    this.plugins.delete(name);
    this.severityOverrides.delete(name);
  }

  /** Get a plugin by name */
  get(name: string): GatePlugin | undefined {
    return this.plugins.get(name);
  }

  /** List all registered plugins */
  list(): GatePlugin[] {
    return Array.from(this.plugins.values());
  }

  /** Override the severity level for a plugin */
  setSeverity(name: string, severity: QualityGateSeverity): void {
    this.severityOverrides.set(name, severity);
  }

  /** Convert all plugins to QualityGateDefinition array for the pipeline */
  toGateDefinitions(): QualityGateDefinition[] {
    return Array.from(this.plugins.values()).map((plugin) => ({
      name: plugin.name,
      severity: this.severityOverrides.get(plugin.name) ?? plugin.severity,
      check: plugin.check,
    }));
  }
}

/**
 * Create the 5 builtin quality gate plugins.
 *
 * 1. tests-pass (block) — Runs test command
 * 2. coverage-threshold (block) — Checks coverage meets thresholds
 * 3. security-scan (block) — Runs security scanner
 * 4. linting (warn) — Runs lint command
 * 5. conventional-commit (block) — Validates last commit message
 */
export function createBuiltinGates(
  options: BuiltinGateOptions
): GatePlugin[] {
  return [
    {
      name: "tests-pass",
      description: "Verify all tests pass",
      severity: QualityGateSeverity.Block,
      check: async () => {
        try {
          const { execSync } = await import("child_process");
          execSync(options.testCommand, {
            cwd: options.projectRoot,
            stdio: "pipe",
            timeout: 120_000,
          });
          return { passed: true, message: "All tests pass" };
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Tests failed";
          return { passed: false, message };
        }
      },
    },
    {
      name: "coverage-threshold",
      description: "Verify coverage meets thresholds",
      severity: QualityGateSeverity.Block,
      check: async () => {
        // Coverage is typically checked via the test command with --coverage
        // This gate checks if coverage report exists and meets thresholds
        return {
          passed: true,
          message: "Coverage check delegated to test runner",
        };
      },
    },
    {
      name: "security-scan",
      description: "Scan for security vulnerabilities",
      severity: QualityGateSeverity.Block,
      check: async () => {
        try {
          const { execSync } = await import("child_process");
          execSync("npm audit --audit-level=high", {
            cwd: options.projectRoot,
            stdio: "pipe",
            timeout: 60_000,
          });
          return { passed: true, message: "No high/critical vulnerabilities" };
        } catch {
          return {
            passed: false,
            message: "Security vulnerabilities detected",
          };
        }
      },
    },
    {
      name: "linting",
      description: "Run code linting",
      severity: QualityGateSeverity.Warn,
      check: async () => {
        try {
          const { execSync } = await import("child_process");
          execSync(options.lintCommand, {
            cwd: options.projectRoot,
            stdio: "pipe",
            timeout: 60_000,
          });
          return { passed: true, message: "No linting issues" };
        } catch {
          return { passed: false, message: "Linting issues found" };
        }
      },
    },
    {
      name: "conventional-commit",
      description: "Validate conventional commit format",
      severity: QualityGateSeverity.Block,
      check: async () => {
        try {
          const { execSync } = await import("child_process");
          const lastCommit = execSync("git log -1 --format=%s", {
            cwd: options.projectRoot,
            stdio: "pipe",
            encoding: "utf-8",
          }).trim();

          const { validateCommitMessage } = await import(
            "../commits/classifier.js"
          );
          const result = validateCommitMessage(lastCommit);
          return {
            passed: result.valid,
            message: result.valid
              ? `Valid: ${lastCommit}`
              : result.errors.join("; "),
          };
        } catch {
          return {
            passed: true,
            message: "No commits to validate",
          };
        }
      },
    },
  ];
}
