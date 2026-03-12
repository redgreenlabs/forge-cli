import { useState, useEffect } from "react";
import { render, Text, Box, useStdout } from "ink";
import type { LoopState } from "../loop/engine.js";
import { LoopPhase } from "../loop/engine.js";
import { CircuitBreakerState } from "../loop/circuit-breaker.js";
import { TddPhase } from "../tdd/enforcer.js";
import { GateStatus } from "../gates/quality-gates.js";
import type { DashboardState } from "../loop/orchestrator.js";
import type { PipelineResult } from "../gates/quality-gates.js";
import type { AgentLogEntry } from "../tui/renderer.js";

/** Hook to track terminal dimensions */
function useTerminalHeight(): number {
  const { stdout } = useStdout();
  const [height, setHeight] = useState(stdout?.rows ?? 24);

  useEffect(() => {
    const onResize = () => setHeight(stdout?.rows ?? 24);
    stdout?.on("resize", onResize);
    return () => { stdout?.off("resize", onResize); };
  }, [stdout]);

  return height;
}

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

const CB_DISPLAY: Record<CircuitBreakerState, { color: string; label: string }> = {
  [CircuitBreakerState.Closed]: { color: "green", label: "CLOSED" },
  [CircuitBreakerState.HalfOpen]: { color: "yellow", label: "HALF_OPEN" },
  [CircuitBreakerState.Open]: { color: "red", label: "OPEN" },
};

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function ProgressBar({ percent, width = 20 }: { percent: number; width?: number }) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return (
    <Text>
      [<Text color="green">{"█".repeat(filled)}</Text>
      <Text color="gray">{"░".repeat(empty)}</Text>]{" "}
      <Text bold>{percent}%</Text>
    </Text>
  );
}

function Header({ state, startedAt, now }: { state: LoopState; startedAt: number; now: number }) {
  const elapsed = now - startedAt;
  const phaseColor = PHASE_COLORS[state.phase];
  const progress =
    state.totalTasks > 0
      ? Math.round((state.tasksCompleted / state.totalTasks) * 100)
      : 0;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box borderStyle="round" borderColor="cyan" paddingX={2}>
        <Text bold color="white">
          FORGE Development Loop
        </Text>
      </Box>
      <Box gap={2} marginTop={1}>
        <Text>
          <Text bold>Iteration:</Text>{" "}
          <Text color="white">{String(state.iteration).padStart(2)}</Text>
        </Text>
        <Text>
          <Text bold>Phase:</Text>{" "}
          <Text color={phaseColor}>{state.phase.toUpperCase()}</Text>
        </Text>
        <Text>
          <Text bold>Elapsed:</Text>{" "}
          <Text color="gray">{formatElapsed(elapsed)}</Text>
        </Text>
      </Box>
      <Box gap={1}>
        <Text bold>Progress: </Text>
        <ProgressBar percent={progress} />
        <Text color="gray">
          ({state.tasksCompleted}/{state.totalTasks})
        </Text>
      </Box>
    </Box>
  );
}

function CurrentTask({ name }: { name?: string }) {
  if (!name) return null;
  const display = name.length > 50 ? name.slice(0, 47) + "..." : name;
  return (
    <Box marginBottom={1}>
      <Text>
        {"  "}<Text bold>Task:</Text>{" "}
        <Text color="white">{display}</Text>
      </Text>
    </Box>
  );
}

function StatusRow({
  state,
  tddPhase,
  tddCycles,
  commitCount,
}: {
  state: LoopState;
  tddPhase: TddPhase;
  tddCycles: number;
  commitCount: number;
}) {
  const cb = CB_DISPLAY[state.circuitBreakerState];
  const tdd = TDD_DISPLAY[tddPhase];

  return (
    <Box gap={2} marginBottom={1}>
      <Text>
        <Text bold>TDD:</Text>{" "}
        <Text color={tdd.color}>● {tdd.label}</Text>
      </Text>
      <Text>
        <Text bold>Cycles:</Text> {tddCycles}
      </Text>
      <Text>
        <Text bold>Commits:</Text>{" "}
        <Text color={commitCount > 0 ? "green" : "gray"}>{commitCount}</Text>
      </Text>
      <Text>
        <Text bold>Files:</Text> {state.filesModifiedThisIteration}
      </Text>
      <Text>
        <Text bold>Circuit:</Text>{" "}
        <Text color={cb.color}>{cb.label}</Text>
      </Text>
    </Box>
  );
}

function QualityGatesPanel({ result }: { result?: PipelineResult }) {
  if (!result) return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Quality Gates:</Text>
      {result.results.map((gate) => {
        let icon: string;
        let color: string;
        switch (gate.status) {
          case GateStatus.Passed:
            icon = "✓";
            color = "green";
            break;
          case GateStatus.Failed:
            icon = "✗";
            color = "red";
            break;
          case GateStatus.Warning:
            icon = "⚠";
            color = "yellow";
            break;
          default:
            icon = "○";
            color = "gray";
        }
        return (
          <Text key={gate.name}>
            {"  "}
            <Text color={color}>{icon}</Text> {gate.name.padEnd(22)}{" "}
            <Text color="gray">{gate.message}</Text>
          </Text>
        );
      })}
    </Box>
  );
}

function AgentLog({ entries, maxEntries = 8 }: { entries: AgentLogEntry[]; maxEntries?: number }) {
  const recent = entries.slice(-maxEntries);
  const agentColors: Record<string, string> = {
    architect: "cyan",
    implementer: "green",
    tester: "yellow",
    reviewer: "magenta",
    security: "red",
    documenter: "blue",
    system: "gray",
  };

  return (
    <Box flexDirection="column">
      <Text bold>Agent Activity:</Text>
      {recent.length === 0 ? (
        <Text color="gray">  Waiting for first phase...</Text>
      ) : (
        recent.map((entry, i) => (
          <Text key={i}>
            {"  "}
            <Text color="gray">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </Text>{" "}
            <Text color={agentColors[entry.agent] ?? "white"}>
              [{entry.agent}]
            </Text>{" "}
            {entry.action}{" "}
            <Text color="gray">{entry.detail}</Text>
          </Text>
        ))
      )}
    </Box>
  );
}

/**
 * Live Ink-based TUI dashboard component.
 *
 * Renders a real-time updating terminal UI with:
 * - Loop iteration, phase, and elapsed time
 * - Current task name
 * - Progress bar with task counts
 * - TDD phase indicator with color
 * - Commit count and circuit breaker status
 * - Quality gate results
 * - Agent activity log (last 8 entries)
 * - Animated spinner while running
 */
const WORK_INDICATORS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function Dashboard({ state, startedAt }: { state: DashboardState; startedAt: number }) {
  const termHeight = useTerminalHeight();
  const [tick, setTick] = useState(0);

  // Single timer drives both elapsed clock and spinner — no extra re-renders
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Calculate how many agent log lines we can fit.
  // Fixed lines: header border(3) + stats(2) + progress(1) + blank(1) + task(1)
  //   + status row(1) + agent header(1) + separator(1) + spinner(1) = ~12
  // Quality gates take variable lines.
  const gateLines = state.qualityReport ? state.qualityReport.results.length + 1 : 0;
  const fixedLines = 12 + gateLines;
  const availableForLog = Math.max(2, termHeight - fixedLines);
  const spinnerChar = WORK_INDICATORS[tick % WORK_INDICATORS.length];

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header state={state.loop} startedAt={startedAt} now={Date.now()} />
      <CurrentTask name={state.currentTask} />
      <StatusRow
        state={state.loop}
        tddPhase={state.tddPhase}
        tddCycles={state.tddCycles}
        commitCount={state.commitCount}
      />
      <QualityGatesPanel result={state.qualityReport} />
      <AgentLog entries={state.agentLog} maxEntries={availableForLog} />
      <Box marginTop={1}>
        <Text color="gray">{"─".repeat(50)}</Text>
      </Box>
      {state.loop.phase !== LoopPhase.Idle ? (
        <Box>
          <Text color="green">{spinnerChar} </Text>
          <Text color="gray">Claude is working...</Text>
        </Box>
      ) : (
        <Box>
          <Text color="gray">  Idle</Text>
        </Box>
      )}
    </Box>
  );
}

/** Exported update function type for external state pushing */
export type DashboardUpdater = (state: DashboardState) => void;

/**
 * Start the live Ink dashboard and return an updater function.
 *
 * The caller pushes state updates via the returned function,
 * and the dashboard re-renders automatically.
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

  const { unmount, clear } = render(<LiveWrapper />);

  return {
    updater: (state: DashboardState) => {
      if (setExternalState) setExternalState(state);
    },
    cleanup: () => {
      clear();
      unmount();
    },
  };
}

export { Dashboard };
