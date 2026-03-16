import { useState, useEffect } from "react";
import { render, Text, Box, useStdout, useInput } from "ink";
import { LoopPhase } from "../loop/engine.js";
import { CircuitBreakerState } from "../loop/circuit-breaker.js";
import { TddPhase } from "../tdd/enforcer.js";
import { GateStatus } from "../gates/quality-gates.js";
import type { DashboardState } from "../loop/orchestrator.js";
import type { PipelineResult, GateResult } from "../gates/quality-gates.js";
import type { CodeQualityMetrics, CoverageMetrics, SecurityMetrics, CostMetrics } from "../tui/renderer.js";

// ── Constants ──────────────────────────────────────────────────────

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const PHASE_COLORS: Record<LoopPhase, string> = {
  [LoopPhase.Idle]: "gray",
  [LoopPhase.Planning]: "cyan",
  [LoopPhase.Testing]: "yellow",
  [LoopPhase.Implementing]: "green",
  [LoopPhase.Reviewing]: "magenta",
  [LoopPhase.SecurityScan]: "red",
  [LoopPhase.Committing]: "blue",
  [LoopPhase.QualityGate]: "white",
  [LoopPhase.Documenting]: "cyan",
};

const TDD_DISPLAY: Record<TddPhase, { color: string; label: string }> = {
  [TddPhase.Red]: { color: "red", label: "RED" },
  [TddPhase.Green]: { color: "green", label: "GREEN" },
  [TddPhase.Refactor]: { color: "yellow", label: "REFACTOR" },
};

// ── Hooks ──────────────────────────────────────────────────────────

function useTerminalSize(): { width: number; height: number } {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    width: stdout?.columns ?? 80,
    height: stdout?.rows ?? 24,
  });

  useEffect(() => {
    const onResize = () =>
      setSize({
        width: stdout?.columns ?? 80,
        height: stdout?.rows ?? 24,
      });
    stdout?.on("resize", onResize);
    return () => { stdout?.off("resize", onResize); };
  }, [stdout]);

  return size;
}

// ── Helpers ────────────────────────────────────────────────────────

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

// ── Compact Header (3 lines) ───────────────────────────────────────

function CompactHeader({ state, tick, startedAt }: {
  state: DashboardState;
  tick: number;
  startedAt: number;
}) {
  const elapsed = Date.now() - startedAt;
  const { loop, tddPhase, tddCycles, commitCount, cost } = state;
  const phaseColor = PHASE_COLORS[loop.phase];
  const progress = loop.totalTasks > 0
    ? Math.round((loop.tasksCompleted / loop.totalTasks) * 100)
    : 0;
  const spinnerChar = loop.phase !== LoopPhase.Idle ? SPINNER[tick % SPINNER.length] : " ";
  const filled = Math.round((progress / 100) * 12);
  const empty = 12 - filled;
  const cbColor = loop.circuitBreakerState === CircuitBreakerState.Open ? "red"
    : loop.circuitBreakerState === CircuitBreakerState.HalfOpen ? "yellow" : "green";

  return (
    <Box flexDirection="column">
      {/* Line 1: Status + Progress + Elapsed + Cost */}
      <Box>
        <Text color="cyan" bold> FORGE </Text>
        <Text color={phaseColor}>{spinnerChar} {loop.phase.toUpperCase().padEnd(12)}</Text>
        <Text> [</Text>
        <Text color="green">{"█".repeat(filled)}</Text>
        <Text color="gray">{"░".repeat(empty)}</Text>
        <Text>] </Text>
        <Text>{loop.tasksCompleted}/{loop.totalTasks}</Text>
        <Text color="gray"> {formatElapsed(elapsed)}</Text>
        <Text color="gray"> ↻</Text><Text>{commitCount}</Text>
        {cost && <Text color="yellow"> {formatCost(cost.totalUsd)}</Text>}
        <Text color={cbColor}> {loop.circuitBreakerState === CircuitBreakerState.Closed ? "" : ` ⚡${loop.circuitBreakerState.toUpperCase()}`}</Text>
      </Box>
      {/* Line 2: Current task */}
      <Box>
        <Text color="gray"> Task: </Text>
        <Text color="white">{state.currentTask
          ? (state.currentTask.length > 70 ? state.currentTask.slice(0, 67) + "..." : state.currentTask)
          : "waiting..."}</Text>
      </Box>
      {/* Line 3: TDD pipeline visualization */}
      <Box>
        <Text> </Text>
        <TddPipeline tddPhase={tddPhase} tddCycles={tddCycles} qualityReport={state.qualityReport} />
        {state.rateLimitWaiting && (
          <Text color="yellow"> ⏳ Rate limited — {Math.ceil(Math.max(0, state.rateLimitWaiting.until - Date.now()) / 1000)}s</Text>
        )}
      </Box>
    </Box>
  );
}

/** TDD phase pipeline: ✓Red → ●Green → ○Refactor → ○Gates */
function TddPipeline({ tddPhase, tddCycles, qualityReport }: {
  tddPhase: TddPhase;
  tddCycles: number;
  qualityReport?: PipelineResult;
}) {
  const phases: Array<{ label: string; color: string; status: "done" | "active" | "pending" | "failed" }> = [];

  // Determine phase status based on current TDD phase
  const phaseOrder = [TddPhase.Red, TddPhase.Green, TddPhase.Refactor];
  const currentIdx = phaseOrder.indexOf(tddPhase);

  for (let i = 0; i < phaseOrder.length; i++) {
    const p = phaseOrder[i]!;
    const display = TDD_DISPLAY[p];
    phases.push({
      label: display.label,
      color: display.color,
      status: i < currentIdx ? "done" : i === currentIdx ? "active" : "pending",
    });
  }

  // Gates status
  const gatesFailed = qualityReport && !qualityReport.passed;
  phases.push({
    label: "Gates",
    color: gatesFailed ? "red" : "white",
    status: gatesFailed ? "failed" : qualityReport ? "done" : "pending",
  });

  return (
    <Box>
      {phases.map((p, i) => {
        const icon = p.status === "done" ? "✓" : p.status === "active" ? "●" : p.status === "failed" ? "✗" : "○";
        return (
          <Text key={p.label}>
            {i > 0 && <Text color="gray"> → </Text>}
            <Text color={p.status === "pending" ? "gray" : p.color}>{icon}{p.label}</Text>
          </Text>
        );
      })}
      {tddCycles > 0 && <Text color="gray"> ({tddCycles} cycles)</Text>}
    </Box>
  );
}

// ── Claude Output (full-width, fills remaining space) ──────────────

function LogLine({ line, maxWidth }: { line: string; maxWidth: number }) {
  const truncated = line.length > maxWidth ? line.slice(0, maxWidth - 1) + "…" : line;

  if (/^⚡/.test(line)) return <Text color="cyan">{truncated}</Text>;
  if (/\b(?:error|fail|FAIL|Error|panic)\b/i.test(line)) return <Text color="red">{truncated}</Text>;
  if (/\b(?:PASS|pass|✓|passed)\b/.test(line)) return <Text color="green">{truncated}</Text>;
  if (/\b(?:cost|Done —)\b/i.test(line)) return <Text color="yellow">{truncated}</Text>;
  return <Text color="gray">{truncated}</Text>;
}

function ClaudeOutput({ logs, height, width }: { logs: string[]; height: number; width: number }) {
  const visible = logs.slice(-height);
  const maxW = Math.max(10, width - 2);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {visible.length === 0 ? (
        <Text color="gray" dimColor> Waiting for Claude...</Text>
      ) : (
        visible.map((line, i) => (
          <Box key={i}><Text> </Text><LogLine line={line} maxWidth={maxW} /></Box>
        ))
      )}
    </Box>
  );
}

// ── Dashboard Overlay (toggle with 'd') ────────────────────────────

function DashboardOverlay({ state }: { state: DashboardState }) {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text bold color="cyan"> Dashboard</Text>
      <Text color="gray">{" ─".repeat(30)}</Text>

      {/* Cost Breakdown */}
      <CostPanel cost={state.cost} />

      {/* Quality Gates Detail */}
      {state.qualityReport && <GatesDetail report={state.qualityReport} />}

      {/* Coverage */}
      {state.coverage && <CoveragePanel coverage={state.coverage} />}

      {/* Security */}
      {state.security && <SecurityPanel security={state.security} />}

      {/* Code Metrics */}
      {state.codeMetrics && <CodeMetricsPanel metrics={state.codeMetrics} />}

      <Box marginTop={1}>
        <Text color="gray"> Press </Text><Text bold>d</Text><Text color="gray"> to close</Text>
      </Box>
    </Box>
  );
}

function CostPanel({ cost }: { cost?: CostMetrics }) {
  if (!cost) return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold> Cost</Text>
      <Text color="gray">  No API calls yet</Text>
    </Box>
  );

  const avgPerCall = cost.apiCalls > 0 ? cost.totalUsd / cost.apiCalls : 0;
  const avgPerTask = cost.completedTasks > 0 ? cost.totalUsd / cost.completedTasks : 0;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold> Cost</Text>
      <Box>
        <Text>  Total: </Text><Text color="yellow" bold>{formatCost(cost.totalUsd)}</Text>
        <Text color="gray">  |  This task: </Text><Text color="yellow">{formatCost(cost.currentTaskUsd)}</Text>
        <Text color="gray">  |  API calls: </Text><Text>{cost.apiCalls}</Text>
      </Box>
      <Box>
        <Text color="gray">  Avg/call: </Text><Text>{formatCost(avgPerCall)}</Text>
        {cost.completedTasks > 0 && (
          <>
            <Text color="gray">  |  Avg/task: </Text><Text>{formatCost(avgPerTask)}</Text>
          </>
        )}
      </Box>
      {Object.keys(cost.perPhase).length > 0 && (
        <Box>
          <Text color="gray">  By phase: </Text>
          {Object.entries(cost.perPhase).map(([phase, usd], i) => (
            <Text key={phase}>
              {i > 0 && <Text color="gray"> | </Text>}
              <Text color="gray">{phase}: </Text><Text>{formatCost(usd)}</Text>
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

function GatesDetail({ report }: { report: PipelineResult }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold> Quality Gates</Text>
      {report.results.map((gate) => {
        const icon = gate.status === GateStatus.Passed ? "✓"
          : gate.status === GateStatus.Failed ? "✗"
          : gate.status === GateStatus.Warning ? "⚠" : "○";
        const color = gate.status === GateStatus.Passed ? "green"
          : gate.status === GateStatus.Failed ? "red"
          : gate.status === GateStatus.Warning ? "yellow" : "gray";
        return (
          <Text key={gate.name}>
            {"  "}<Text color={color}>{icon}</Text> {gate.name.padEnd(20)} <Text color="gray">{gate.message} ({gate.durationMs}ms)</Text>
          </Text>
        );
      })}
    </Box>
  );
}

function CoveragePanel({ coverage }: { coverage: CoverageMetrics }) {
  const colorFor = (v: number): string => (v >= 80 ? "green" : v >= 60 ? "yellow" : "red");
  const trendIcon = coverage.trend === "up" ? "↑" : coverage.trend === "down" ? "↓" : "→";
  const trendColor = coverage.trend === "up" ? "green" : coverage.trend === "down" ? "red" : "gray";

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold> Coverage</Text>
      <Box>
        <Text>  Lines: </Text><Text color={colorFor(coverage.lines)}>{coverage.lines}%</Text>
        <Text> </Text><Text color={trendColor}>{trendIcon}</Text>
        <Text color="gray">  |  Branches: </Text><Text color={colorFor(coverage.branches)}>{coverage.branches}%</Text>
        <Text color="gray">  |  Functions: </Text><Text color={colorFor(coverage.functions)}>{coverage.functions}%</Text>
      </Box>
    </Box>
  );
}

function SecurityPanel({ security }: { security: SecurityMetrics }) {
  const total = security.critical + security.high + security.medium + security.low;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold> Security</Text>
      {total === 0 ? (
        <Text color="green">  ✓ No findings</Text>
      ) : (
        <Box>
          <Text>  </Text>
          {security.critical > 0 && <Text color="red">{security.critical} CRIT </Text>}
          {security.high > 0 && <Text color="red">{security.high} HIGH </Text>}
          {security.medium > 0 && <Text color="yellow">{security.medium} MED </Text>}
          {security.low > 0 && <Text color="gray">{security.low} LOW </Text>}
        </Box>
      )}
    </Box>
  );
}

function CodeMetricsPanel({ metrics }: { metrics: CodeQualityMetrics }) {
  const ratioColor = metrics.testRatio >= 1.0 ? "green" : metrics.testRatio >= 0.5 ? "yellow" : "red";
  const complexityColor = metrics.averageComplexity <= 5 ? "green" : metrics.averageComplexity <= 10 ? "yellow" : "red";

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold> Code Quality</Text>
      <Box>
        <Text>  Tests: </Text><Text color={ratioColor}>{metrics.testRatio.toFixed(2)}</Text>
        <Text color="gray"> ({metrics.testFiles}/{metrics.sourceFiles})</Text>
        <Text color="gray">  |  Complexity: </Text><Text color={complexityColor}>{metrics.averageComplexity.toFixed(1)} avg</Text>
        {metrics.highComplexityCount > 0 && (
          <Text color="yellow"> ⚠ {metrics.highComplexityCount} high</Text>
        )}
      </Box>
    </Box>
  );
}

// ── Footer (keybinds + inline gate icons) ──────────────────────────

function FooterBar({ qualityReport }: { qualityReport?: PipelineResult }) {
  return (
    <Box>
      <Box flexGrow={1}>
        <Text color="gray"> [</Text><Text bold>d</Text><Text color="gray">]dashboard [</Text>
        <Text bold>q</Text><Text color="gray">]quit</Text>
      </Box>
      {qualityReport && (
        <Box>
          <InlineGates results={qualityReport.results} />
          <Text> </Text>
        </Box>
      )}
    </Box>
  );
}

function InlineGates({ results }: { results: GateResult[] }) {
  return (
    <Box>
      {results.map((gate) => {
        const icon = gate.status === GateStatus.Passed ? "✓"
          : gate.status === GateStatus.Failed ? "✗"
          : gate.status === GateStatus.Warning ? "⚠" : "○";
        const color = gate.status === GateStatus.Passed ? "green"
          : gate.status === GateStatus.Failed ? "red"
          : gate.status === GateStatus.Warning ? "yellow" : "gray";
        // Shorten gate names for footer
        const short = gate.name
          .replace("tests-pass", "tests")
          .replace("coverage-threshold", "cov")
          .replace("security-scan", "sec")
          .replace("conventional-commit", "commit");
        return (
          <Text key={gate.name}>
            <Text color={color}>{icon}</Text>
            <Text color={color === "green" ? "gray" : color}>{short} </Text>
          </Text>
        );
      })}
    </Box>
  );
}

// ── Gate Failure Inline (shown below header when gates fail) ───────

function GateFailureBanner({ report }: { report: PipelineResult }) {
  if (report.passed) return null;
  const failed = report.results.filter(r => r.status === GateStatus.Failed || r.status === GateStatus.Error);
  if (failed.length === 0) return null;

  return (
    <Box flexDirection="column">
      {failed.map((gate) => (
        <Box key={gate.name}>
          <Text color="red"> ✗ {gate.name}: </Text>
          <Text color="gray">{gate.message.slice(0, 80)}</Text>
        </Box>
      ))}
    </Box>
  );
}

// ── Root Dashboard Component ───────────────────────────────────────

function Dashboard({ state, startedAt }: { state: DashboardState; startedAt: number }) {
  const { width: termWidth, height: termHeight } = useTerminalSize();
  const [tick, setTick] = useState(0);
  const [showOverlay, setShowOverlay] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useInput((input) => {
    if (input === "d") setShowOverlay((prev) => !prev);
  });

  // Header = 3 lines, footer = 1 line, separator = 1 line, gate failure banner
  const gateFailureLines = state.qualityReport && !state.qualityReport.passed
    ? state.qualityReport.results.filter(r => r.status === GateStatus.Failed || r.status === GateStatus.Error).length
    : 0;
  const chromeHeight = 3 + 1 + 1 + gateFailureLines; // header + separator + footer + failures
  const contentHeight = Math.max(3, termHeight - chromeHeight);

  return (
    <Box flexDirection="column" width={termWidth} height={termHeight}>
      <CompactHeader state={state} tick={tick} startedAt={startedAt} />

      {/* Gate failure banner (inline, only when gates fail) */}
      {state.qualityReport && !state.qualityReport.passed && (
        <GateFailureBanner report={state.qualityReport} />
      )}

      {/* Separator */}
      <Box>
        <Text color="gray">{" ─".repeat(Math.min(40, Math.floor(termWidth / 2)))}</Text>
      </Box>

      {/* Main content: overlay or Claude output */}
      {showOverlay ? (
        <DashboardOverlay state={state} />
      ) : (
        <ClaudeOutput logs={state.claudeLogs ?? []} height={contentHeight} width={termWidth} />
      )}

      {/* Footer */}
      <FooterBar qualityReport={state.qualityReport} />
    </Box>
  );
}

// ── Public API ─────────────────────────────────────────────────────

/** Exported update function type for external state pushing */
export type DashboardUpdater = (state: DashboardState) => void;

/**
 * Start the live Ink dashboard and return an updater function.
 *
 * Layout:
 * - Compact 3-line header (status, task, TDD pipeline)
 * - Full-width Claude output (85%+ of screen)
 * - Footer with keybinds + gate status icons
 * - Press 'd' to toggle dashboard overlay (cost, coverage, security, gates)
 */
export function startLiveDashboard(
  initialState: DashboardState
): { updater: DashboardUpdater; cleanup: () => void } {
  let setExternalState: ((s: DashboardState) => void) | null = null;
  const startedAt = Date.now();

  function LiveWrapper() {
    const [dashState, setDashState] = useState(initialState);

    useEffect(() => {
      setExternalState = setDashState;
      return () => {
        setExternalState = null;
      };
    }, []);

    return <Dashboard state={dashState} startedAt={startedAt} />;
  }

  // Enter alternate screen buffer (like vim/htop)
  process.stdout.write("\x1b[?1049h");
  process.stdout.write("\x1b[H");

  const { unmount, clear } = render(<LiveWrapper />);

  return {
    updater: (state: DashboardState) => {
      if (setExternalState) setExternalState(state);
    },
    cleanup: () => {
      clear();
      unmount();
      process.stdout.write("\x1b[?1049l");
    },
  };
}

export { Dashboard, CoveragePanel, SecurityPanel };
