import { useState, useEffect } from "react";
import { render, Text, Box, useStdout, useInput } from "ink";
import { LoopPhase } from "../loop/engine.js";
import { CircuitBreakerState } from "../loop/circuit-breaker.js";
import { TddPhase } from "../tdd/enforcer.js";
import { GateStatus } from "../gates/quality-gates.js";
import type { DashboardState, TaskFailureAction } from "../loop/orchestrator.js";
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
    <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1} paddingY={0}>
      {/* Row 1: Phase + Tasks + Iteration */}
      <Box gap={3}>
        <Text>
          <Text bold>Phase:</Text>{" "}
          <Text color={phaseColor}>{loop.phase.toUpperCase()}</Text>
        </Text>
        <Text>
          <Text bold>Tasks:</Text>{" "}
          <Text color={loop.tasksCompleted > 0 ? "green" : "white"}>{loop.tasksCompleted}</Text>
          <Text color="gray">/{loop.totalTasks}</Text>
        </Text>
        <Text>
          <Text bold>Iter:</Text> {loop.iteration}
        </Text>
        {loop.circuitBreakerState !== CircuitBreakerState.Closed && (
          <Text color={cbColor} bold>Circuit: {loop.circuitBreakerState.toUpperCase()}</Text>
        )}
      </Box>

      {/* Row 2: Elapsed + Cost + Commits + Files */}
      <Box gap={3}>
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

      {/* Row 3: Progress bar */}
      <Text> </Text>
      <Box gap={2}>
        <Text>
          [<Text color="green">{"█".repeat(filled)}</Text>
          <Text color="gray">{"░".repeat(empty)}</Text>]{" "}
          <Text bold>{progress}%</Text>
        </Text>
      </Box>

      {/* Row 4: Task name */}
      <Box>
        <Text bold>Task: </Text>
        <Text color="white">{state.currentTask
          ? (state.currentTask.length > 65 ? state.currentTask.slice(0, 62) + "..." : state.currentTask)
          : "waiting..."}</Text>
      </Box>

      {/* Row 5: TDD pipeline */}
      <Text> </Text>
      <Box gap={1}>
        <TddPipeline tddPhase={tddPhase} tddCycles={tddCycles} qualityReport={state.qualityReport} />
      </Box>

      {/* Row 6: Quality gates (when available) */}
      {state.qualityReport && (
        <Box gap={1}>
          <Text bold>Gates:</Text>
          {state.qualityReport.results.map((gate) => {
            const icon = gate.status === GateStatus.Passed ? "✓"
              : gate.status === GateStatus.Failed ? "✗"
              : gate.status === GateStatus.Warning ? "⚠" : "○";
            const color = gate.status === GateStatus.Passed ? "green"
              : gate.status === GateStatus.Failed ? "red"
              : gate.status === GateStatus.Warning ? "yellow" : "gray";
            return (
              <Text key={gate.name}>
                <Text color={color}>{icon} {gate.name}</Text>
              </Text>
            );
          })}
          <Text color="gray">({state.qualityReport.totalDurationMs}ms)</Text>
        </Box>
      )}
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

function ClaudeOutputBox({ logs }: { logs: string[] }) {
  const { width: termWidth, height: termHeight } = useTerminalSize();
  // Border (2) + header (1) = 3 lines of own chrome
  const maxW = Math.max(10, termWidth - 6); // border + padding
  // Show as many lines as terminal allows; flexGrow handles the actual box sizing
  const maxLines = Math.max(1, termHeight - 3);
  const visible = logs.slice(-maxLines);

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
    <Box borderStyle="single" borderColor="cyan" flexDirection="column" flexGrow={1} paddingX={2}>
      <Text bold color="cyan">Dashboard</Text>
      <Text> </Text>

      {/* Cost */}
      <CostPanel cost={state.cost} />

      {/* Quality Gates */}
      {state.qualityReport && (
        <>
          <Text> </Text>
          <GatesDetail report={state.qualityReport} />
        </>
      )}

      {/* Coverage */}
      {state.coverage && (
        <>
          <Text> </Text>
          <CoveragePanel coverage={state.coverage} />
        </>
      )}

      {/* Security */}
      {state.security && (
        <>
          <Text> </Text>
          <SecurityPanel security={state.security} />
        </>
      )}

      {/* Code Metrics */}
      {state.codeMetrics && (
        <>
          <Text> </Text>
          <CodeMetricsPanel metrics={state.codeMetrics} />
        </>
      )}

      <Box marginTop={1}>
        <Text color="gray">Press </Text><Text bold>d</Text><Text color="gray"> to close</Text>
      </Box>
    </Box>
  );
}

function CostPanel({ cost }: { cost?: CostMetrics }) {
  return (
    <Box flexDirection="column">
      <Text bold color="yellow">Cost</Text>
      {!cost ? (
        <Text color="gray">  No executions yet</Text>
      ) : (
        <>
          <Box gap={4}>
            <Text>  <Text bold>Total:</Text> <Text color="yellow" bold>{formatCost(cost.totalUsd)}</Text></Text>
            <Text><Text bold>This task:</Text> <Text color="yellow">{formatCost(cost.currentTaskUsd)}</Text></Text>
            <Text><Text bold>Executions:</Text> {cost.executions}</Text>
          </Box>
          <Box gap={4}>
            <Text color="gray">  Avg/execution: {formatCost(cost.executions > 0 ? cost.totalUsd / cost.executions : 0)}</Text>
            {cost.completedTasks > 0 && (
              <Text color="gray">Avg/task: {formatCost(cost.totalUsd / cost.completedTasks)}</Text>
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
        </>
      )}
    </Box>
  );
}

function GatesDetail({ report }: { report: PipelineResult }) {
  return (
    <Box flexDirection="column">
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
            <Text color={color}>  {icon} {gate.name.padEnd(20)}</Text> <Text color="gray">{gate.message} ({gate.durationMs}ms)</Text>
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
    <Box flexDirection="column">
      <Text bold>Coverage</Text>
      <Box gap={4}>
        <Text>  Lines: <Text color={colorFor(coverage.lines)}>{coverage.lines}%</Text> <Text color={trendColor}>{trendIcon}</Text></Text>
        <Text>Branches: <Text color={colorFor(coverage.branches)}>{coverage.branches}%</Text></Text>
        <Text>Functions: <Text color={colorFor(coverage.functions)}>{coverage.functions}%</Text></Text>
      </Box>
    </Box>
  );
}

function SecurityPanel({ security }: { security: SecurityMetrics }) {
  const total = security.critical + security.high + security.medium + security.low;
  return (
    <Box flexDirection="column">
      <Text bold>Security</Text>
      {total === 0 ? (
        <Text color="green">  ✓ No findings</Text>
      ) : (
        <Box gap={3}>
          {security.critical > 0 && <Text color="red">  {security.critical} CRITICAL</Text>}
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
    <Box flexDirection="column">
      <Text bold>Code Quality</Text>
      <Box gap={4}>
        <Text>  Test ratio: <Text color={ratioColor}>{metrics.testRatio.toFixed(2)}</Text> <Text color="gray">({metrics.testFiles}/{metrics.sourceFiles})</Text></Text>
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
        <Text color="gray">[</Text><Text bold>d</Text><Text color="gray">] Dashboard  [</Text>
        <Text bold>q</Text><Text color="gray">] Quit</Text>
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

// ── Rate Limit Modal ──────────────────────────────────────────────

function RateLimitModal({ until }: { until: number }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const remainingMs = Math.max(0, until - now);
  const totalSec = Math.ceil(remainingMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const countdown = hours > 0
    ? `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`
    : minutes > 0
      ? `${minutes}m ${String(seconds).padStart(2, "0")}s`
      : `${seconds}s`;

  const resetsAt = new Date(until).toLocaleTimeString();

  return (
    <Box
      borderStyle="single"
      borderColor="yellow"
      flexDirection="column"
      flexGrow={1}
      paddingX={2}
      paddingY={1}
      justifyContent="center"
      alignItems="center"
    >
      <Text> </Text>
      <Text bold color="yellow">API Rate Limit Reached</Text>
      <Text> </Text>
      <Text color="white">Waiting for rate limit to reset...</Text>
      <Text> </Text>
      <Text bold color="cyan">{countdown}</Text>
      <Text> </Text>
      <Text color="gray">Resets at {resetsAt}</Text>
      <Text color="gray">Session will resume automatically</Text>
      <Text> </Text>
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

// ── Task Failure Modal ────────────────────────────────────────────

interface TaskFailureInfo {
  id: string;
  title: string;
  failCount: number;
  lastError: string | null;
}

function TaskFailureModal({ task, onDecision }: {
  task: TaskFailureInfo;
  onDecision: (action: TaskFailureAction) => void;
}) {
  const [selected, setSelected] = useState(0);
  const [guidance, setGuidance] = useState("");
  const [inputMode, setInputMode] = useState(false);

  const options = [
    { label: "Retry with guidance", desc: "provide a hint to help" },
    { label: "Skip for now", desc: "defer to later" },
    { label: "Skip permanently", desc: "won't retry" },
    { label: "Abort session", desc: "stop forge" },
  ];

  useInput((input, key) => {
    if (inputMode) {
      if (key.return) {
        onDecision({ action: "retry", guidance });
        return;
      }
      if (key.escape) { setInputMode(false); return; }
      if (key.backspace || key.delete) {
        setGuidance((g) => g.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setGuidance((g) => g + input);
      }
      return;
    }

    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(options.length - 1, s + 1));
    if (key.return) {
      if (selected === 0) setInputMode(true);
      else if (selected === 1) onDecision({ action: "defer" });
      else if (selected === 2) onDecision({ action: "skip" });
      else if (selected === 3) onDecision({ action: "abort" });
    }
  });

  const errorPreview = task.lastError
    ? task.lastError.slice(0, 120) + (task.lastError.length > 120 ? "..." : "")
    : "Unknown error";

  return (
    <Box
      borderStyle="single"
      borderColor="yellow"
      flexDirection="column"
      flexGrow={1}
      paddingX={2}
      paddingY={1}
    >
      <Text bold color="yellow">Task Failed ({task.failCount}x)</Text>
      <Text> </Text>
      <Text color="white" bold>{task.title}</Text>
      <Text color="red">{errorPreview}</Text>
      <Text> </Text>

      {inputMode ? (
        <Box flexDirection="column">
          <Text color="cyan">Enter guidance (Enter to submit, Esc to cancel):</Text>
          <Box>
            <Text color="green">&gt; </Text>
            <Text>{guidance}<Text color="gray">_</Text></Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text color="gray">What would you like to do?</Text>
          <Text> </Text>
          {options.map((opt, i) => (
            <Box key={opt.label}>
              <Text color={i === selected ? "cyan" : "gray"}>
                {i === selected ? "▸ " : "  "}{opt.label}
              </Text>
              <Text color="gray"> — {opt.desc}</Text>
            </Box>
          ))}
          <Text> </Text>
          <Text color="gray">Use ↑↓ arrows and Enter to select</Text>
        </Box>
      )}
    </Box>
  );
}

// ── Root Dashboard Component ───────────────────────────────────────

function Dashboard({ state, startedAt, onQuit, taskFailure, onTaskFailureDecision }: {
  state: DashboardState;
  startedAt: number;
  onQuit?: () => void;
  taskFailure?: TaskFailureInfo | null;
  onTaskFailureDecision?: (action: TaskFailureAction) => void;
}) {
  const { width: termWidth, height: termHeight } = useTerminalSize();
  const [tick, setTick] = useState(0);
  const [showOverlay, setShowOverlay] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useInput((input) => {
    // When task failure modal is active, it handles its own input
    if (taskFailure) return;

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

      {/* Main content: task failure modal, rate limit modal, overlay, or Claude output */}
      {taskFailure && onTaskFailureDecision ? (
        <TaskFailureModal task={taskFailure} onDecision={onTaskFailureDecision} />
      ) : state.rateLimitWaiting ? (
        <RateLimitModal until={state.rateLimitWaiting.until} />
      ) : showOverlay ? (
        <DashboardOverlay state={state} />
      ) : (
        <ClaudeOutputBox logs={state.claudeLogs ?? []} />
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
): {
  updater: DashboardUpdater;
  cleanup: () => void;
  promptTaskFailure: (task: { id: string; title: string; failCount: number; lastError: string | null }) => Promise<TaskFailureAction>;
} {
  let setExternalState: ((s: DashboardState) => void) | null = null;
  let setExternalTaskFailure: ((task: TaskFailureInfo | null) => void) | null = null;
  let setExternalDecisionHandler: ((handler: ((action: TaskFailureAction) => void) | null) => void) | null = null;
  const startedAt = Date.now();
  const onQuit = options?.onQuit;

  function LiveWrapper() {
    const [dashState, setDashState] = useState(initialState);
    const [taskFailure, setTaskFailure] = useState<TaskFailureInfo | null>(null);
    const [decisionHandler, setDecisionHandler] = useState<((action: TaskFailureAction) => void) | null>(null);

    useEffect(() => {
      setExternalState = setDashState;
      setExternalTaskFailure = setTaskFailure;
      setExternalDecisionHandler = (handler) => setDecisionHandler(() => handler);
      return () => {
        setExternalState = null;
        setExternalTaskFailure = null;
        setExternalDecisionHandler = null;
      };
    }, []);

    const handleDecision = (action: TaskFailureAction) => {
      if (decisionHandler) decisionHandler(action);
      setTaskFailure(null);
      setDecisionHandler(null);
    };

    return (
      <Dashboard
        state={dashState}
        startedAt={startedAt}
        onQuit={onQuit}
        taskFailure={taskFailure}
        onTaskFailureDecision={handleDecision}
      />
    );
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
    promptTaskFailure: (task) => {
      return new Promise<TaskFailureAction>((resolve) => {
        if (setExternalTaskFailure) setExternalTaskFailure(task);
        if (setExternalDecisionHandler) setExternalDecisionHandler(resolve);
      });
    },
  };
}

export { Dashboard, CoveragePanel, SecurityPanel };
