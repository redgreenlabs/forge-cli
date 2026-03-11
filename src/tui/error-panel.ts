import chalk from "chalk";

/** Error severity levels */
export enum ErrorSeverity {
  Critical = "critical",
  Warning = "warning",
  Info = "info",
}

const SEVERITY_RANK: Record<ErrorSeverity, number> = {
  [ErrorSeverity.Critical]: 0,
  [ErrorSeverity.Warning]: 1,
  [ErrorSeverity.Info]: 2,
};

/** An error or warning entry */
export interface ErrorEntry {
  severity: ErrorSeverity;
  source: string;
  message: string;
  timestamp: number;
}

/** Status metrics for the warning panel */
export interface WarningPanelData {
  circuitBreakerState: string;
  rateLimitRemaining: number;
  rateLimitTotal: number;
  permissionDenials: number;
  buildFailures: number;
  testFailures: number;
}

/** Format a single error entry with color coding */
export function formatErrorEntry(entry: ErrorEntry): string {
  const badge = formatSeverityBadge(entry.severity);
  const source = chalk.dim(`[${entry.source}]`);
  return `${badge} ${source} ${entry.message}`;
}

/** Render the error/warning panel */
export function renderErrorPanel(errors: ErrorEntry[]): string {
  if (errors.length === 0) return "";

  const sorted = [...errors].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  );

  const lines: string[] = [
    chalk.bold.red("═══ Errors & Warnings ═══"),
    "",
  ];

  for (const entry of sorted) {
    lines.push(formatErrorEntry(entry));
  }

  return lines.join("\n");
}

/** Render the system status warning panel */
export function renderWarningPanel(data: WarningPanelData): string {
  const lines: string[] = [
    chalk.bold.yellow("═══ System Status ═══"),
    "",
  ];

  // Circuit breaker
  const cbColor =
    data.circuitBreakerState === "open"
      ? chalk.red
      : data.circuitBreakerState === "half_open"
        ? chalk.yellow
        : chalk.green;
  lines.push(
    `  Circuit Breaker: ${cbColor(data.circuitBreakerState.toUpperCase())}`
  );

  // Rate limit
  const rlPercent = data.rateLimitTotal > 0
    ? (data.rateLimitRemaining / data.rateLimitTotal) * 100
    : 100;
  const rlColor = rlPercent < 20 ? chalk.red : rlPercent < 50 ? chalk.yellow : chalk.green;
  lines.push(
    `  Rate Limit:      ${rlColor(`${data.rateLimitRemaining}/${data.rateLimitTotal}`)}`
  );

  // Failures
  if (data.testFailures > 0) {
    lines.push(`  Test Failures:   ${chalk.red(String(data.testFailures))}`);
  }
  if (data.buildFailures > 0) {
    lines.push(`  Build Failures:  ${chalk.red(String(data.buildFailures))}`);
  }
  if (data.permissionDenials > 0) {
    lines.push(`  Permission Deny: ${chalk.yellow(String(data.permissionDenials))}`);
  }

  return lines.join("\n");
}

function formatSeverityBadge(severity: ErrorSeverity): string {
  switch (severity) {
    case ErrorSeverity.Critical:
      return chalk.bgRed.white.bold(" CRITICAL ");
    case ErrorSeverity.Warning:
      return chalk.bgYellow.black.bold(" WARNING ");
    case ErrorSeverity.Info:
      return chalk.bgBlue.white(" INFO ");
  }
}
