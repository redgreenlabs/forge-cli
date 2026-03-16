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

// ── Title Bar ──────────────────────────────────────────────────────

function TitleBar({ tick, phase }: { tick: number; phase: LoopPhase }) {
  const spinnerChar = phase !== LoopPhase.Idle ? SPINNER[tick % SPINNER.length] : " ";
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={2} justifyContent="center">
      <Text bold color="white">FORGE</Text>
      <Text color="gray">  Development Loop  </Text>
      {phase !== LoopPhase.Idle && <Text color="green">{spinnerChar}</Text>}
    </Box>
  );
}

// ── Status Box ─────────────────────────────────────────────────────

function StatusBox({ state, startedAt }: {
  state: DashboardState;
  startedAt: number;
}) {
  const elapsed = Date.now() - startedAt;
  const { loop, tddPhase, tddCycles, commitCount, cost } = state;
  const phaseColor = PHASE_COLORS[loop.phase];
  const progress = loop.totalTasks > 0
    ? Math.round((loop.tasksCompleted / loop.totalTasks) * 100)
    : 0;
  const filled = Math.round((progress / 100) * 14);
  const empty = 14 - filled;
  const cbColor = loop.circuitBreakerState === CircuitBreakerState.Open ? "red"
    : loop.circuitBreakerState === CircuitBreakerState.HalfOpen ? "yellow" : "green";

  return (
    <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1}>
      {/* Row 1: Phase + Progress + Stats */}
      <Box gap={2}>
        <Text>
          <Text bold>Phase:</Text>{" "}
          <Text color={phaseColor}>{loop.phase.toUpperCase()}</Text>
        </Text>
        <Text>
          <Text bold>Iter:</Text> {loop.iteration}
        </Text>
        <Text>
          <Text bold>Elapsed:</Text>{" "}
          <Text color="gray">{formatElapsed(elapsed)}</Text>
        </Text>
        {cost && (
          <Text>
            <Text bold>Cost:</Text>{" "}
            <Text color="yellow">{formatCost(cost.totalUsd)}</Text>
          </Text>
        )}
        {loop.circuitBreakerState !== CircuitBreakerState.Closed && (
          <Text color={cbColor} bold>Circuit: {loop.circuitBreakerState.toUpperCase()}</Text>
        )}
      </Box>

      {/* Row 2: Progress bar + Task counters */}
      <Box gap={2}>
        <Text>
          [<Text color="green">{"█".repeat(filled)}</Text>
          <Text color="gray">{"░".repeat(empty)}</Text>]{" "}
          <Text bold>{progress}%</Text>{" "}
          <Text color="gray">({loop.tasksCompleted}/{loop.totalTasks} tasks)</Text>
        </Text>
        <Text>
          <Text bold>Commits:</Text>{" "}
          <Text color={commitCount > 0 ? "green" : "gray"}>{commitCount}</Text>
        </Text>
        {loop.filesModifiedThisIteration > 0 && (
          <Text>
            <Text bold>Files:</Text> {loop.filesModifiedThisIteration}
          </Text>
        )}
      </Box>

      {/* Row 3: Task name */}
      <Box>
        <Text bold>Task: </Text>
        <Text color="white">{state.currentTask
          ? (state.currentTask.length > 65 ? state.currentTask.slice(0, 62) + "..." : state.currentTask)
          : "waiting..."}</Text>
      </Box>

      {/* Row 4: TDD pipeline */}
      <Box gap={1}>
        <TddPipeline tddPhase={tddPhase} tddCycles={tddCycles} qualityReport={state.qualityReport} />
        {state.rateLimitWaiting && (
          <Text color="yellow">⏳ Rate limited — {Math.ceil(Math.max(0, state.rateLimitWaiting.until - Date.now()) / 1000)}s</Text>
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
  const phaseOrder = [TddPhase.Red, TddPhase.Green, TddPhase.Refactor];
  const currentIdx = phaseOrder.indexOf(tddPhase);

  const phases: Array<{ label: string; color: string; status: "done" | "active" | "pending" | "failed" }> = [];
  for (let i = 0; i < phaseOrder.length; i++) {
    const p = phaseOrder[i]!;
    const display = TDD_DISPLAY[p];
    phases.push({
      label: display.label,
      color: display.color,
      status: i < currentIdx ? "done" : i === currentIdx ? "active" : "pending",
    });
  }

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

// ── Claude Output Box ──────────────────────────────────────────────

function LogLine({ line, maxWidth }: { line: string; maxWidth: number }) {
  const truncated = line.length > maxWidth ? line.slice(0, maxWidth - 1) + "…" : line;

  if (/^⚡/.test(line)) return <Text color="cyan">{truncated}</Text>;
  if (/\b(?:error|fail|FAIL|Error|panic)\b/i.test(line)) return <Text color="red">{truncated}</Text>;
  if (/\b(?:PASS|pass|✓|passed)\b/.test(line)) return <Text color="green">{truncated}</Text>;
  if (/\b(?:cost|Done —)\b/i.test(line)) return <Text color="yellow">{truncated}</Text>;
  return <Text color="gray">{truncated}</Text>;
}

function ClaudeOutputBox({ logs, height, width }: { logs: string[]; height: number; width: number }) {
  // Account for border (2 lines) + header (1 line)
  const contentHeight = Math.max(1, height - 3);
  const visible = logs.slice(-contentHeight);
  const maxW = Math.max(10, width - 6); // border + padding

  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      flexDirection="column"
      flexGrow={1}
      paddingX={1}
    >
      <Text bold color="gray">Claude Output</Text>
      {visible.length === 0 ? (
        <Text color="gray" dimColor>Waiting for Claude...</Text>
      ) : (
        visible.map((line, i) => (
          <LogLine key={i} line={line} maxWidth={maxW} />
        ))
      )}
    </Box>
  );
}

// ── Dashboard Overlay (toggle with 'd') ────────────────────────────

function DashboardOverlay({ state }: { state: DashboardState }) {
  return (
    <Box borderStyle="single" borderColor="cyan" flexDirection="column" flexGrow={1} paddingX={1}>
      <Text bold color="cyan">Dashboard</Text>

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
        <Text color="gray">Press </Text><Text bold>d</Text><Text color="gray"> to close</Text>
      </Box>
    </Box>
  );
}

function CostPanel({ cost }: { cost?: CostMetrics }) {
  return (
    <Box borderStyle="single" borderColor="yellow" flexDirection="column" paddingX={1} marginBottom={1}>
      <Text bold color="yellow">Cost</Text>
      {!cost ? (
        <Text color="gray">No executions yet</Text>
      ) : (
        <>
          <Box gap={3}>
            <Text><Text bold>Total:</Text> <Text color="yellow" bold>{formatCost(cost.totalUsd)}</Text></Text>
            <Text><Text bold>This task:</Text> <Text color="yellow">{formatCost(cost.currentTaskUsd)}</Text></Text>
            <Text><Text bold>Executions:</Text> {cost.executions}</Text>
          </Box>
          <Box gap={3}>
            <Text color="gray">Avg/execution: {formatCost(cost.executions > 0 ? cost.totalUsd / cost.executions : 0)}</Text>
            {cost.completedTasks > 0 && (
              <Text color="gray">Avg/task: {formatCost(cost.totalUsd / cost.completedTasks)}</Text>
            )}
          </Box>
          {Object.keys(cost.perPhase).length > 0 && (
            <Box>
              <Text color="gray">By phase: </Text>
              {Object.entries(cost.perPhase).map(([phase, usd], i) => (
                <Text key={phase}>
                  {i > 0 && <Text color="gray"> | </Text>}
                  <Text color="gray">{phase}: </Text><Text>{formatCost(usd)}</Text>
                </Text>
              ))}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

function GatesDetail({ report }: { report: PipelineResult }) {
  return (
    <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1} marginBottom={1}>
      <Text bold>Quality Gates</Text>
      {report.results.map((gate) => {
        const icon = gate.status === GateStatus.Passed ? "✓"
          : gate.status === GateStatus.Failed ? "✗"
          : gate.status === GateStatus.Warning ? "⚠" : "○";
        const color = gate.status === GateStatus.Passed ? "green"
          : gate.status === GateStatus.Failed ? "red"
          : gate.status === GateStatus.Warning ? "yellow" : "gray";
        return (
          <Text key={gate.name}>
            <Text color={color}>{icon}</Text> {gate.name.padEnd(20)} <Text color="gray">{gate.message} ({gate.durationMs}ms)</Text>
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
    <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1} marginBottom={1}>
      <Text bold>Coverage</Text>
      <Box gap={3}>
        <Text>Lines: <Text color={colorFor(coverage.lines)}>{coverage.lines}%</Text> <Text color={trendColor}>{trendIcon}</Text></Text>
        <Text>Branches: <Text color={colorFor(coverage.branches)}>{coverage.branches}%</Text></Text>
        <Text>Functions: <Text color={colorFor(coverage.functions)}>{coverage.functions}%</Text></Text>
      </Box>
    </Box>
  );
}

function SecurityPanel({ security }: { security: SecurityMetrics }) {
  const total = security.critical + security.high + security.medium + security.low;
  return (
    <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1} marginBottom={1}>
      <Text bold>Security</Text>
      {total === 0 ? (
        <Text color="green">✓ No findings</Text>
      ) : (
        <Box gap={2}>
          {security.critical > 0 && <Text color="red">{security.critical} CRITICAL</Text>}
          {security.high > 0 && <Text color="red">{security.high} HIGH</Text>}
          {security.medium > 0 && <Text color="yellow">{security.medium} MEDIUM</Text>}
          {security.low > 0 && <Text color="gray">{security.low} LOW</Text>}
        </Box>
      )}
    </Box>
  );
}

function CodeMetricsPanel({ metrics }: { metrics: CodeQualityMetrics }) {
  const ratioColor = metrics.testRatio >= 1.0 ? "green" : metrics.testRatio >= 0.5 ? "yellow" : "red";
  const complexityColor = metrics.averageComplexity <= 5 ? "green" : metrics.averageComplexity <= 10 ? "yellow" : "red";

  return (
    <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1} marginBottom={1}>
      <Text bold>Code Quality</Text>
      <Box gap={3}>
        <Text>Test ratio: <Text color={ratioColor}>{metrics.testRatio.toFixed(2)}</Text> <Text color="gray">({metrics.testFiles}/{metrics.sourceFiles})</Text></Text>
        <Text>Complexity: <Text color={complexityColor}>{metrics.averageComplexity.toFixed(1)} avg</Text></Text>
        {metrics.highComplexityCount > 0 && (
          <Text color="yellow">⚠ {metrics.highComplexityCount} high</Text>
        )}
      </Box>
    </Box>
  );
}

// ── Footer ─────────────────────────────────────────────────────────

function FooterBar({ qualityReport }: { qualityReport?: PipelineResult }) {
  return (
    <Box paddingX={1}>
      <Box flexGrow={1}>
        <Text color="gray">[</Text><Text bold>d</Text><Text color="gray">] dashboard  [</Text>
        <Text bold>q</Text><Text color="gray">] quit</Text>
      </Box>
      {qualityReport && <InlineGates results={qualityReport.results} />}
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

// ── Gate Failure Banner ────────────────────────────────────────────

function GateFailureBanner({ report }: { report: PipelineResult }) {
  if (report.passed) return null;
  const failed = report.results.filter(r => r.status === GateStatus.Failed || r.status === GateStatus.Error);
  if (failed.length === 0) return null;

  return (
    <Box borderStyle="single" borderColor="red" flexDirection="column" paddingX={1}>
      <Text bold color="red">Gate Failures</Text>
      {failed.map((gate) => (
        <Text key={gate.name}>
          <Text color="red">✗ {gate.name}: </Text>
          <Text color="gray">{gate.message.slice(0, 80)}</Text>
        </Text>
      ))}
    </Box>
  );
}

// ── Root Dashboard Component ───────────────────────────────────────

function Dashboard({ state, startedAt, onQuit }: { state: DashboardState; startedAt: number; onQuit?: () => void }) {
  const { width: termWidth, height: termHeight } = useTerminalSize();
  const [tick, setTick] = useState(0);
  const [showOverlay, setShowOverlay] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useInput((input) => {
    if (confirmQuit) {
      if (input === "y" || input === "Y") {
        setConfirmQuit(false);
        onQuit?.();
      } else {
        setConfirmQuit(false);
      }
      return;
    }
    if (input === "d") setShowOverlay((prev) => !prev);
    if (input === "q") setConfirmQuit(true);
  });

  // Calculate available height for main content
  // Title = 3 (border + text + border), Status = 6, Footer = 1, gate failures variable
  const gateFailureLines = state.qualityReport && !state.qualityReport.passed
    ? state.qualityReport.results.filter(r => r.status === GateStatus.Failed || r.status === GateStatus.Error).length + 2
    : 0;
  const chromeHeight = 3 + 6 + 1 + gateFailureLines;
  const contentHeight = Math.max(5, termHeight - chromeHeight);

  return (
    <Box flexDirection="column" width={termWidth} height={termHeight}>
      {/* Title */}
      <TitleBar tick={tick} phase={state.loop.phase} />

      {/* Status */}
      <StatusBox state={state} startedAt={startedAt} />

      {/* Gate failure banner (only when gates fail) */}
      {state.qualityReport && !state.qualityReport.passed && (
        <GateFailureBanner report={state.qualityReport} />
      )}

      {/* Main content: overlay or Claude output */}
      {showOverlay ? (
        <DashboardOverlay state={state} />
      ) : (
        <ClaudeOutputBox
          logs={state.claudeLogs ?? []}
          height={contentHeight}
          width={termWidth}
        />
      )}

      {/* Footer */}
      {confirmQuit ? (
        <Box paddingX={1}>
          <Text bold color="yellow">Quit FORGE? </Text>
          <Text color="gray">[</Text><Text bold color="green">y</Text><Text color="gray">] yes  [</Text>
          <Text bold color="red">n</Text><Text color="gray">] cancel</Text>
        </Box>
      ) : (
        <FooterBar qualityReport={state.qualityReport} />
      )}
    </Box>
  );
}

// ── Public API ─────────────────────────────────────────────────────

export type DashboardUpdater = (state: DashboardState) => void;

/**
 * Start the live Ink dashboard and return an updater function.
 *
 * Layout:
 * - Title bar (bordered, centered)
 * - Status box (bordered: phase, progress, task, TDD pipeline)
 * - Claude output box (bordered, fills remaining space)
 * - Footer with keybinds + gate status icons
 * - Press 'd' to toggle dashboard overlay (cost, coverage, security, gates)
 */
export function startLiveDashboard(
  initialState: DashboardState,
  options?: { onQuit?: () => void }
): { updater: DashboardUpdater; cleanup: () => void } {
  let setExternalState: ((s: DashboardState) => void) | null = null;
  const startedAt = Date.now();
  const onQuit = options?.onQuit;

  function LiveWrapper() {
    const [dashState, setDashState] = useState(initialState);

    useEffect(() => {
      setExternalState = setDashState;
      return () => {
        setExternalState = null;
      };
    }, []);

    return <Dashboard state={dashState} startedAt={startedAt} onQuit={onQuit} />;
  }

  // Enter alternate screen buffer
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
