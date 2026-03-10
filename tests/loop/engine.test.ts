import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LoopEngine,
  LoopPhase,
  type LoopState,
  type LoopEventHandler,
} from "../../src/loop/engine.js";
import { defaultConfig } from "../../src/config/schema.js";
import { CircuitBreakerState } from "../../src/loop/circuit-breaker.js";

describe("LoopEngine", () => {
  let engine: LoopEngine;
  let events: string[];
  let handler: LoopEventHandler;

  beforeEach(() => {
    events = [];
    handler = {
      onIterationStart: vi.fn((state) => {
        events.push(`start:${state.iteration}`);
      }),
      onIterationEnd: vi.fn((state) => {
        events.push(`end:${state.iteration}`);
      }),
      onPhaseChange: vi.fn((phase) => {
        events.push(`phase:${phase}`);
      }),
      onQualityGateResult: vi.fn(),
      onError: vi.fn((error) => {
        events.push(`error:${error.message}`);
      }),
      onComplete: vi.fn((state) => {
        events.push(`complete:${state.iteration}`);
      }),
    };
    engine = new LoopEngine({ ...defaultConfig, maxIterations: 3 }, handler);
  });

  describe("initial state", () => {
    it("should start at iteration 0", () => {
      expect(engine.state.iteration).toBe(0);
    });

    it("should start in idle phase", () => {
      expect(engine.state.phase).toBe(LoopPhase.Idle);
    });

    it("should not be running", () => {
      expect(engine.state.running).toBe(false);
    });

    it("should have CLOSED circuit breaker", () => {
      expect(engine.state.circuitBreakerState).toBe(
        CircuitBreakerState.Closed
      );
    });
  });

  describe("state management", () => {
    it("should track iteration count", () => {
      engine.incrementIteration();
      expect(engine.state.iteration).toBe(1);
    });

    it("should track phase transitions", () => {
      engine.setPhase(LoopPhase.Testing);
      expect(engine.state.phase).toBe(LoopPhase.Testing);
      expect(handler.onPhaseChange).toHaveBeenCalledWith(LoopPhase.Testing);
    });

    it("should track all valid phases", () => {
      const phases = Object.values(LoopPhase);
      expect(phases).toContain(LoopPhase.Idle);
      expect(phases).toContain(LoopPhase.Planning);
      expect(phases).toContain(LoopPhase.Testing);
      expect(phases).toContain(LoopPhase.Implementing);
      expect(phases).toContain(LoopPhase.Reviewing);
      expect(phases).toContain(LoopPhase.SecurityScan);
      expect(phases).toContain(LoopPhase.Committing);
      expect(phases).toContain(LoopPhase.QualityGate);
    });

    it("should track tasks completed", () => {
      engine.recordTaskCompleted("task-1");
      engine.recordTaskCompleted("task-2");
      expect(engine.state.tasksCompleted).toBe(2);
      expect(engine.state.completedTaskIds).toContain("task-1");
    });

    it("should not double-count tasks", () => {
      engine.recordTaskCompleted("task-1");
      engine.recordTaskCompleted("task-1");
      expect(engine.state.tasksCompleted).toBe(1);
    });

    it("should track files modified", () => {
      engine.recordFilesModified(["src/a.ts", "src/b.ts"]);
      expect(engine.state.filesModifiedThisIteration).toBe(2);
    });
  });

  describe("stop conditions", () => {
    it("should stop at maxIterations", () => {
      expect(engine.shouldStop()).toBe(false);
      engine.incrementIteration();
      engine.incrementIteration();
      engine.incrementIteration();
      expect(engine.shouldStop()).toBe(true);
      expect(engine.stopReason).toBe("max_iterations_reached");
    });

    it("should stop when all tasks complete", () => {
      engine.setTotalTasks(2);
      engine.recordTaskCompleted("task-1");
      expect(engine.shouldStop()).toBe(false);
      engine.recordTaskCompleted("task-2");
      expect(engine.shouldStop()).toBe(true);
      expect(engine.stopReason).toBe("all_tasks_complete");
    });

    it("should stop when circuit breaker opens", () => {
      engine.setCircuitBreakerState(CircuitBreakerState.Open);
      expect(engine.shouldStop()).toBe(true);
      expect(engine.stopReason).toBe("circuit_breaker_open");
    });

    it("should not stop in HALF_OPEN state", () => {
      engine.setCircuitBreakerState(CircuitBreakerState.HalfOpen);
      expect(engine.shouldStop()).toBe(false);
    });
  });

  describe("event emission", () => {
    it("should emit iteration start events", () => {
      engine.emitIterationStart();
      expect(handler.onIterationStart).toHaveBeenCalledWith(engine.state);
    });

    it("should emit iteration end events", () => {
      engine.emitIterationEnd();
      expect(handler.onIterationEnd).toHaveBeenCalledWith(engine.state);
    });

    it("should emit completion event", () => {
      engine.emitComplete();
      expect(handler.onComplete).toHaveBeenCalledWith(engine.state);
    });

    it("should emit error events", () => {
      const error = new Error("test error");
      engine.emitError(error);
      expect(handler.onError).toHaveBeenCalledWith(error);
    });
  });

  describe("serialization", () => {
    it("should serialize state to JSON", () => {
      engine.incrementIteration();
      engine.recordTaskCompleted("task-1");
      engine.setPhase(LoopPhase.Testing);

      const json = engine.toJSON();
      expect(json.iteration).toBe(1);
      expect(json.tasksCompleted).toBe(1);
      expect(json.phase).toBe(LoopPhase.Testing);
    });

    it("should restore state from JSON", () => {
      engine.incrementIteration();
      engine.recordTaskCompleted("task-1");

      const json = engine.toJSON();
      const restored = LoopEngine.fromJSON(json, defaultConfig, handler);
      expect(restored.state.iteration).toBe(1);
      expect(restored.state.tasksCompleted).toBe(1);
    });
  });
});
