import { useState, useEffect } from "react";
import { render, Text, Box } from "ink";
import Spinner from "ink-spinner";
import type { LoopState } from "../loop/engine.js";
import { LoopPhase } from "../loop/engine.js";
import { CircuitBreakerState } from "../loop/circuit-breaker.js";
import { TddPhase } from "../tdd/enforcer.js";
import { GateStatus } from "../gates/quality-gates.js";
import type { DashboardState } from "../loop/orchestrator.js";
import type { PipelineResult } from "../gates/quality-gates.js";
import type { AgentLogEntry } from "../tui/renderer.js";

/** Props for the live dashboard component */
interface DashboardProps {
  initialState: DashboardState;
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

function Header({ state }: { state: LoopState }) {
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
          <Text color="white">{String(state.iteration).padStart(3)}</Text>
        </Text>
        <Text>
          <Text bold>Phase:</Text>{" "}
          <Text color={phaseColor}>{state.phase.toUpperCase()}</Text>
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

function StatusRow({ state, tddPhase, tddCycles }: { state: LoopState; tddPhase: TddPhase; tddCycles: number }) {
  const cb = CB_DISPLAY[state.circuitBreakerState];
  const tdd = TDD_DISPLAY[tddPhase];

  return (
    <Box gap={2} marginBottom={1}>
      <Text>
        <Text bold>Circuit:</Text>{" "}
        <Text color={cb.color}>{cb.label}</Text>
      </Text>
      <Text>
        <Text bold>TDD:</Text>{" "}
        <Text color={tdd.color}>● {tdd.label}</Text>
      </Text>
      <Text>
        <Text bold>Cycles:</Text> {tddCycles}
      </Text>
      <Text>
        <Text bold>Files:</Text> {state.filesModifiedThisIteration}
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

function AgentLog({ entries }: { entries: AgentLogEntry[] }) {
  const recent = entries.slice(-8);
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
        <Text color="gray">  No activity yet</Text>
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
 * - Loop iteration and phase
 * - Progress bar
 * - TDD phase indicator
 * - Circuit breaker status
 * - Quality gate results
 * - Agent activity log
 */
function Dashboard({ initialState }: DashboardProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Header state={initialState.loop} />
      <StatusRow
        state={initialState.loop}
        tddPhase={initialState.tddPhase}
        tddCycles={initialState.tddCycles}
      />
      <QualityGatesPanel result={initialState.qualityReport} />
      <AgentLog entries={initialState.agentLog} />
      <Box marginTop={1}>
        <Text color="gray">{"─".repeat(50)}</Text>
      </Box>
      {initialState.loop.phase !== LoopPhase.Idle && (
        <Box>
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Text color="gray"> Running...</Text>
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

  function LiveWrapper() {
    const [dashState, setDashState] = useState(initialState);

    useEffect(() => {
      setExternalState = setDashState;
      return () => {
        setExternalState = null;
      };
    }, []);

    return <Dashboard initialState={dashState} />;
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
