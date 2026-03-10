import chalk from "chalk";

export type ReportFormat = "terminal" | "json" | "html";

/** Aggregated data for a health report */
export interface ReportData {
  projectName: string;
  generatedAt: string;
  sessions: {
    total: number;
    totalIterations: number;
    averageIterationsPerSession: number;
  };
  tests: {
    total: number;
    passed: number;
    failed: number;
    coverage: {
      lines: number;
      branches: number;
      functions: number;
    };
  };
  security: {
    findings: { critical: number; high: number; medium: number; low: number };
    lastScanAt: string;
    secretsDetected: number;
  };
  commits: {
    total: number;
    byType: Record<string, number>;
    conventionalRate: number;
  };
  qualityGates: {
    totalRuns: number;
    passRate: number;
    mostFailedGate: string;
  };
  tdd: {
    cyclesCompleted: number;
    violations: number;
  };
}

/**
 * Generate a health report in the specified format.
 */
export function generateReport(data: ReportData, format: ReportFormat): string {
  switch (format) {
    case "json":
      return JSON.stringify(data, null, 2);
    case "html":
      return generateHtmlReport(data);
    case "terminal":
    default:
      return generateTerminalReport(data);
  }
}

function generateTerminalReport(data: ReportData): string {
  const lines: string[] = [];
  const hr = chalk.gray("─".repeat(50));

  lines.push("");
  lines.push(chalk.bold.cyan(`  Forge Health Report: ${data.projectName}`));
  lines.push(`  ${chalk.gray(data.generatedAt)}`);
  lines.push(hr);

  // Sessions
  lines.push(chalk.bold("\n  Sessions"));
  lines.push(`    Total sessions:    ${data.sessions.total}`);
  lines.push(`    Total iterations:  ${data.sessions.totalIterations}`);
  lines.push(
    `    Avg per session:   ${data.sessions.averageIterationsPerSession.toFixed(1)}`
  );

  // Tests
  lines.push(chalk.bold("\n  Tests"));
  const testColor = data.tests.failed === 0 ? chalk.green : chalk.red;
  lines.push(
    `    Results:  ${testColor(`${data.tests.passed}/${data.tests.total} passed`)} (${data.tests.failed} failed)`
  );
  const covColor = (v: number) =>
    v >= 80 ? chalk.green : v >= 60 ? chalk.yellow : chalk.red;
  lines.push(
    `    Coverage: Lines ${covColor(data.tests.coverage.lines)(`${data.tests.coverage.lines}%`)}  Branches ${covColor(data.tests.coverage.branches)(`${data.tests.coverage.branches}%`)}  Functions ${covColor(data.tests.coverage.functions)(`${data.tests.coverage.functions}%`)}`
  );

  // Security
  lines.push(chalk.bold("\n  Security"));
  const { findings } = data.security;
  if (
    findings.critical + findings.high + findings.medium + findings.low ===
    0
  ) {
    lines.push(`    ${chalk.green("No findings")}`);
  } else {
    const parts: string[] = [];
    if (findings.critical > 0) parts.push(chalk.red(`${findings.critical} CRITICAL`));
    if (findings.high > 0) parts.push(chalk.red(`${findings.high} HIGH`));
    if (findings.medium > 0) parts.push(chalk.yellow(`${findings.medium} MEDIUM`));
    if (findings.low > 0) parts.push(chalk.gray(`${findings.low} LOW`));
    lines.push(`    Findings: ${parts.join("  ")}`);
  }
  lines.push(`    Secrets:  ${data.security.secretsDetected === 0 ? chalk.green("None detected") : chalk.red(`${data.security.secretsDetected} found`)}`);

  // Commits
  lines.push(chalk.bold("\n  Commits"));
  lines.push(`    Total:        ${data.commits.total}`);
  lines.push(
    `    Conventional: ${data.commits.conventionalRate >= 90 ? chalk.green(`${data.commits.conventionalRate}%`) : chalk.yellow(`${data.commits.conventionalRate}%`)}`
  );
  const typeEntries = Object.entries(data.commits.byType)
    .sort(([, a], [, b]) => b - a)
    .map(([type, count]) => `${type}:${count}`)
    .join("  ");
  lines.push(`    Breakdown:    ${chalk.gray(typeEntries)}`);

  // Quality Gates
  lines.push(chalk.bold("\n  Quality Gates"));
  lines.push(`    Total runs: ${data.qualityGates.totalRuns}`);
  const prColor =
    data.qualityGates.passRate >= 90
      ? chalk.green
      : data.qualityGates.passRate >= 70
        ? chalk.yellow
        : chalk.red;
  lines.push(`    Pass rate:  ${prColor(`${data.qualityGates.passRate}%`)}`);
  if (data.qualityGates.mostFailedGate) {
    lines.push(
      `    Weakest:    ${chalk.yellow(data.qualityGates.mostFailedGate)}`
    );
  }

  // TDD
  lines.push(chalk.bold("\n  TDD"));
  lines.push(`    Cycles completed: ${data.tdd.cyclesCompleted}`);
  lines.push(
    `    Violations:       ${data.tdd.violations === 0 ? chalk.green("0") : chalk.red(String(data.tdd.violations))}`
  );

  lines.push(hr);
  lines.push("");

  return lines.join("\n");
}

function generateHtmlReport(data: ReportData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Forge Health Report: ${escHtml(data.projectName)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #1a1a2e; background: #fafafa; }
    h1 { color: #0891b2; border-bottom: 2px solid #0891b2; padding-bottom: 0.5rem; }
    h2 { color: #334155; margin-top: 2rem; }
    .metric { display: inline-block; padding: 0.5rem 1rem; margin: 0.25rem; border-radius: 6px; background: #fff; border: 1px solid #e2e8f0; }
    .metric .value { font-size: 1.5rem; font-weight: bold; }
    .metric .label { font-size: 0.85rem; color: #64748b; }
    .good { color: #16a34a; }
    .warn { color: #ca8a04; }
    .bad { color: #dc2626; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #e2e8f0; }
    th { background: #f1f5f9; font-weight: 600; }
    .timestamp { color: #94a3b8; font-size: 0.85rem; }
  </style>
</head>
<body>
  <h1>Forge Health Report: ${escHtml(data.projectName)}</h1>
  <p class="timestamp">Generated: ${escHtml(data.generatedAt)}</p>

  <h2>Tests</h2>
  <div class="metric">
    <div class="value ${data.tests.failed === 0 ? "good" : "bad"}">${data.tests.passed}/${data.tests.total}</div>
    <div class="label">Tests Passing</div>
  </div>

  <h2>Coverage</h2>
  <div class="metric">
    <div class="value ${data.tests.coverage.lines >= 80 ? "good" : "warn"}">${data.tests.coverage.lines}%</div>
    <div class="label">Lines</div>
  </div>
  <div class="metric">
    <div class="value ${data.tests.coverage.branches >= 70 ? "good" : "warn"}">${data.tests.coverage.branches}%</div>
    <div class="label">Branches</div>
  </div>
  <div class="metric">
    <div class="value ${data.tests.coverage.functions >= 80 ? "good" : "warn"}">${data.tests.coverage.functions}%</div>
    <div class="label">Functions</div>
  </div>

  <h2>Security</h2>
  <table>
    <tr><th>Severity</th><th>Count</th></tr>
    <tr><td>Critical</td><td class="${data.security.findings.critical > 0 ? "bad" : "good"}">${data.security.findings.critical}</td></tr>
    <tr><td>High</td><td class="${data.security.findings.high > 0 ? "bad" : "good"}">${data.security.findings.high}</td></tr>
    <tr><td>Medium</td><td class="${data.security.findings.medium > 0 ? "warn" : "good"}">${data.security.findings.medium}</td></tr>
    <tr><td>Low</td><td>${data.security.findings.low}</td></tr>
  </table>

  <h2>Commits</h2>
  <div class="metric">
    <div class="value">${data.commits.total}</div>
    <div class="label">Total Commits</div>
  </div>
  <div class="metric">
    <div class="value ${data.commits.conventionalRate >= 90 ? "good" : "warn"}">${data.commits.conventionalRate}%</div>
    <div class="label">Conventional Rate</div>
  </div>

  <h2>TDD</h2>
  <div class="metric">
    <div class="value good">${data.tdd.cyclesCompleted}</div>
    <div class="label">Cycles Completed</div>
  </div>
  <div class="metric">
    <div class="value ${data.tdd.violations === 0 ? "good" : "bad"}">${data.tdd.violations}</div>
    <div class="label">Violations</div>
  </div>

  <h2>Quality Gates</h2>
  <div class="metric">
    <div class="value ${data.qualityGates.passRate >= 90 ? "good" : data.qualityGates.passRate >= 70 ? "warn" : "bad"}">${data.qualityGates.passRate}%</div>
    <div class="label">Pass Rate (${data.qualityGates.totalRuns} runs)</div>
  </div>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
