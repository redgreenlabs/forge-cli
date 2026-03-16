import chalk from "chalk";
import type { LoopState } from "../loop/engine.js";
import { LoopPhase } from "../loop/engine.js";
import { CircuitBreakerState } from "../loop/circuit-breaker.js";
import type { PipelineResult } from "../gates/quality-gates.js";
import { GateStatus } from "../gates/quality-gates.js";
import { TddPhase } from "../tdd/enforcer.js";

/** Dashboard configuration */
export interface DashboardConfig {
  width: number;
  showAgentLog: boolean;
  showQualityMetrics: boolean;
  showSecurityPanel: boolean;
}

/** Security metrics for display */
export interface SecurityMetrics {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

/** Coverage metrics for display */
export interface CoverageMetrics {
  lines: number;
  branches: number;
  functions: number;
  trend: "up" | "down" | "stable";
}

/** Code quality metrics for display */
export interface CodeQualityMetrics {
  testRatio: number;
  sourceFiles: number;
  testFiles: number;
  averageComplexity: number;
  highComplexityCount: number;
}

/** Agent activity log entry */
export interface AgentLogEntry {
  timestamp: number;
  agent: string;
  action: string;
  detail: string;
}

/** Accumulated cost metrics for display */
export interface CostMetrics {
  /** Total cost across all calls */
  totalUsd: number;
  /** Cost for the current task only */
  currentTaskUsd: number;
  /** Per-phase cost breakdown (phase name → USD) */
  perPhase: Record<string, number>;
  /** Total Claude CLI executions (one per TDD phase) */
  executions: number;
  /** Number of completed tasks (for avg calculation) */
  completedTasks: number;
}

const PHASE_COLORS: Record<LoopPhase, (s: string) => string> = {
  [LoopPhase.Idle]: chalk.gray,
  [LoopPhase.Planning]: chalk.cyan,
  [LoopPhase.Testing]: chalk.yellow,
  [LoopPhase.Implementing]: chalk.green,
  [LoopPhase.Reviewing]: chalk.magenta,
  [LoopPhase.SecurityScan]: chalk.red,
  [LoopPhase.Committing]: chalk.blue,
  [LoopPhase.QualityGate]: chalk.white,
  [LoopPhase.Documenting]: chalk.cyan,
};

const TDD_PHASE_ICONS: Record<TddPhase, string> = {
  [TddPhase.Red]: chalk.red("● RED"),
  [TddPhase.Green]: chalk.green("● GREEN"),
  [TddPhase.Refactor]: chalk.yellow("● REFACTOR"),
};

const CB_STATE_DISPLAY: Record<CircuitBreakerState, string> = {
  [CircuitBreakerState.Closed]: chalk.green("CLOSED"),
  [CircuitBreakerState.HalfOpen]: chalk.yellow("HALF_OPEN"),
  [CircuitBreakerState.Open]: chalk.red("OPEN"),
};

/**
 * Render the main dashboard header with loop state.
 */
export function renderHeader(state: LoopState): string {
  const lines: string[] = [];
  const phaseColor = PHASE_COLORS[state.phase];

  lines.push(chalk.bold.cyan("╔══════════════════════════════════════════╗"));
  lines.push(chalk.bold.cyan("║         ") + chalk.bold.white("FORGE") + chalk.bold.cyan("  Development Loop          ║"));
  lines.push(chalk.bold.cyan("╚══════════════════════════════════════════╝"));
  lines.push("");
  lines.push(
    `  ${chalk.bold("Iteration:")} ${chalk.white(String(state.iteration).padStart(3))}    ${chalk.bold("Phase:")} ${phaseColor(state.phase.toUpperCase().padEnd(14))}`
  );

  const progress = state.totalTasks > 0
    ? Math.round((state.tasksCompleted / state.totalTasks) * 100)
    : 0;
  const progressBar = renderProgressBar(progress, 20);
  lines.push(
    `  ${chalk.bold("Progress:")}  ${progressBar} ${progress}% (${state.tasksCompleted}/${state.totalTasks})`
  );

  lines.push(
    `  ${chalk.bold("Circuit:")}   ${CB_STATE_DISPLAY[state.circuitBreakerState]}    ${chalk.bold("Files:")} ${state.filesModifiedThisIteration} modified`
  );

  return lines.join("\n");
}

/**
 * Render a progress bar.
 */
export function renderProgressBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = chalk.green("█".repeat(filled)) + chalk.gray("░".repeat(empty));
  return `[${bar}]`;
}

/**
 * Render TDD phase indicator.
 */
export function renderTddPhase(phase: TddPhase, cycles: number): string {
  return `  ${chalk.bold("TDD:")}       ${TDD_PHASE_ICONS[phase]}    ${chalk.bold("Cycles:")} ${cycles}`;
}

/**
 * Render quality gate results.
 */
export function renderQualityGates(result: PipelineResult): string {
  const lines: string[] = [];
  lines.push(chalk.bold("\n  Quality Gates:"));

  for (const gate of result.results) {
    let icon: string;
    switch (gate.status) {
      case GateStatus.Passed:
        icon = chalk.green("✓");
        break;
      case GateStatus.Failed:
        icon = chalk.red("✗");
        break;
      case GateStatus.Warning:
        icon = chalk.yellow("⚠");
        break;
      case GateStatus.Error:
        icon = chalk.red("⚡");
        break;
      default:
        icon = chalk.gray("○");
    }
    lines.push(
      `    ${icon} ${gate.name.padEnd(20)} ${gate.message} ${chalk.gray(`(${gate.durationMs}ms)`)}`
    );
  }

  const summary = result.summary;
  lines.push(
    `\n    ${chalk.green(`${summary.passed} passed`)} ${chalk.red(`${summary.failed} failed`)} ${chalk.yellow(`${summary.warnings} warnings`)}`
  );

  return lines.join("\n");
}

/**
 * Render coverage metrics panel.
 */
export function renderCoverage(metrics: CoverageMetrics): string {
  const trendIcon =
    metrics.trend === "up"
      ? chalk.green("↑")
      : metrics.trend === "down"
        ? chalk.red("↓")
        : chalk.gray("→");

  const colorFn = (v: number) =>
    v >= 80 ? chalk.green(v + "%") : v >= 60 ? chalk.yellow(v + "%") : chalk.red(v + "%");

  return [
    chalk.bold("\n  Coverage:"),
    `    Lines:     ${colorFn(metrics.lines)} ${trendIcon}`,
    `    Branches:  ${colorFn(metrics.branches)}`,
    `    Functions: ${colorFn(metrics.functions)}`,
  ].join("\n");
}

/**
 * Render security findings summary.
 */
export function renderSecurity(metrics: SecurityMetrics): string {
  const lines: string[] = [chalk.bold("\n  Security:")];

  if (
    metrics.critical === 0 &&
    metrics.high === 0 &&
    metrics.medium === 0 &&
    metrics.low === 0
  ) {
    lines.push(`    ${chalk.green("✓ No findings")}`);
  } else {
    if (metrics.critical > 0)
      lines.push(`    ${chalk.red(`✗ ${metrics.critical} CRITICAL`)}`);
    if (metrics.high > 0)
      lines.push(`    ${chalk.red(`⚠ ${metrics.high} HIGH`)}`);
    if (metrics.medium > 0)
      lines.push(`    ${chalk.yellow(`  ${metrics.medium} MEDIUM`)}`);
    if (metrics.low > 0)
      lines.push(`    ${chalk.gray(`  ${metrics.low} LOW`)}`);
  }

  return lines.join("\n");
}

/**
 * Render code quality metrics panel (complexity + test ratio).
 */
export function renderCodeMetrics(metrics: CodeQualityMetrics): string {
  const ratioColor = (r: number) =>
    r >= 1.0 ? chalk.green : r >= 0.5 ? chalk.yellow : chalk.red;

  const complexityColor = (c: number) =>
    c <= 5 ? chalk.green : c <= 10 ? chalk.yellow : chalk.red;

  const lines: string[] = [chalk.bold("\n  Code Quality:")];

  lines.push(
    `    Test ratio:    ${ratioColor(metrics.testRatio)(`${metrics.testRatio.toFixed(2)}`)} ${chalk.gray(`(${metrics.testFiles} tests / ${metrics.sourceFiles} source)`)}`
  );
  lines.push(
    `    Complexity:    ${complexityColor(metrics.averageComplexity)(`${metrics.averageComplexity.toFixed(1)} avg`)}`
  );

  if (metrics.highComplexityCount > 0) {
    lines.push(
      `    ${chalk.yellow(`⚠ ${metrics.highComplexityCount} file${metrics.highComplexityCount > 1 ? "s" : ""} above complexity threshold`)}`
    );
  }

  return lines.join("\n");
}

/**
 * Render agent activity log.
 */
export function renderAgentLog(
  entries: AgentLogEntry[],
  maxEntries: number = 10
): string {
  const lines: string[] = [chalk.bold("\n  Agent Activity:")];

  const agentColors: Record<string, (s: string) => string> = {
    architect: chalk.cyan,
    implementer: chalk.green,
    tester: chalk.yellow,
    reviewer: chalk.magenta,
    security: chalk.red,
    documenter: chalk.blue,
  };

  const recent = entries.slice(-maxEntries);
  for (const entry of recent) {
    const colorFn = agentColors[entry.agent] ?? chalk.white;
    const time = new Date(entry.timestamp).toLocaleTimeString();
    lines.push(
      `    ${chalk.gray(time)} ${colorFn(`[${entry.agent}]`.padEnd(14))} ${entry.action} ${chalk.gray(entry.detail)}`
    );
  }

  if (entries.length === 0) {
    lines.push(`    ${chalk.gray("No activity yet")}`);
  }

  return lines.join("\n");
}

/**
 * Render the complete dashboard frame.
 */
export function renderDashboard(options: {
  state: LoopState;
  tddPhase: TddPhase;
  tddCycles: number;
  coverage?: CoverageMetrics;
  security?: SecurityMetrics;
  codeMetrics?: CodeQualityMetrics;
  qualityGates?: PipelineResult;
  agentLog: AgentLogEntry[];
  currentTask?: string;
  commitCount?: number;
}): string {
  const parts: string[] = [];

  parts.push(renderHeader(options.state));

  // Show current task if running
  if (options.currentTask) {
    const taskDisplay = options.currentTask.length > 38
      ? options.currentTask.slice(0, 35) + "..."
      : options.currentTask;
    parts.push(`  ${chalk.bold("Task:")}      ${chalk.white(taskDisplay)}`);
  }

  // Show commit count
  if (options.commitCount !== undefined && options.commitCount > 0) {
    parts.push(`  ${chalk.bold("Commits:")}   ${chalk.green(String(options.commitCount))}`);
  }

  parts.push(renderTddPhase(options.tddPhase, options.tddCycles));

  if (options.coverage) {
    parts.push(renderCoverage(options.coverage));
  }

  if (options.security) {
    parts.push(renderSecurity(options.security));
  }

  if (options.codeMetrics) {
    parts.push(renderCodeMetrics(options.codeMetrics));
  }

  if (options.qualityGates) {
    parts.push(renderQualityGates(options.qualityGates));
  }

  parts.push(renderAgentLog(options.agentLog));
  parts.push("\n" + chalk.gray("─".repeat(44)));

  return parts.join("\n");
}
