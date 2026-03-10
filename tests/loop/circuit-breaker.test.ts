import { describe, it, expect, beforeEach } from "vitest";
import {
  CircuitBreaker,
  CircuitBreakerState,
  type CircuitBreakerConfig,
  type IterationResult,
} from "../../src/loop/circuit-breaker.js";

describe("CircuitBreaker", () => {
  const defaultCbConfig: CircuitBreakerConfig = {
    noProgressThreshold: 3,
    sameErrorThreshold: 3,
    cooldownMinutes: 1,
    autoReset: false,
  };

  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker(defaultCbConfig);
  });

  describe("initial state", () => {
    it("should start in CLOSED state", () => {
      expect(cb.state).toBe(CircuitBreakerState.Closed);
    });

    it("should allow execution in CLOSED state", () => {
      expect(cb.canExecute()).toBe(true);
    });

    it("should have zero failure count", () => {
      expect(cb.stats.noProgressCount).toBe(0);
      expect(cb.stats.sameErrorCount).toBe(0);
    });
  });

  describe("no progress detection", () => {
    it("should track iterations with no file changes", () => {
      cb.recordIteration({ filesModified: 0, error: null, testsPass: true });
      expect(cb.stats.noProgressCount).toBe(1);
    });

    it("should reset counter when progress is made", () => {
      cb.recordIteration({ filesModified: 0, error: null, testsPass: true });
      cb.recordIteration({ filesModified: 0, error: null, testsPass: true });
      cb.recordIteration({ filesModified: 3, error: null, testsPass: true });
      expect(cb.stats.noProgressCount).toBe(0);
    });

    it("should trip to OPEN after threshold exceeded", () => {
      for (let i = 0; i < 3; i++) {
        cb.recordIteration({ filesModified: 0, error: null, testsPass: true });
      }
      expect(cb.state).toBe(CircuitBreakerState.Open);
      expect(cb.canExecute()).toBe(false);
    });

    it("should record trip reason", () => {
      for (let i = 0; i < 3; i++) {
        cb.recordIteration({ filesModified: 0, error: null, testsPass: true });
      }
      expect(cb.tripReason).toBe("no_progress");
    });
  });

  describe("same error detection", () => {
    it("should track repeated errors", () => {
      const error = "TypeError: Cannot read property 'foo'";
      cb.recordIteration({ filesModified: 1, error, testsPass: false });
      cb.recordIteration({ filesModified: 1, error, testsPass: false });
      expect(cb.stats.sameErrorCount).toBe(2);
    });

    it("should reset on different error", () => {
      cb.recordIteration({
        filesModified: 1,
        error: "Error A",
        testsPass: false,
      });
      cb.recordIteration({
        filesModified: 1,
        error: "Error A",
        testsPass: false,
      });
      cb.recordIteration({
        filesModified: 1,
        error: "Error B",
        testsPass: false,
      });
      expect(cb.stats.sameErrorCount).toBe(1);
    });

    it("should trip on repeated errors", () => {
      const error = "Build failed";
      for (let i = 0; i < 3; i++) {
        cb.recordIteration({ filesModified: 1, error, testsPass: false });
      }
      expect(cb.state).toBe(CircuitBreakerState.Open);
      expect(cb.tripReason).toBe("same_error");
    });
  });

  describe("state transitions", () => {
    it("should transition from OPEN to HALF_OPEN after cooldown", () => {
      // Trip the breaker
      for (let i = 0; i < 3; i++) {
        cb.recordIteration({ filesModified: 0, error: null, testsPass: true });
      }
      expect(cb.state).toBe(CircuitBreakerState.Open);

      // Simulate cooldown elapsed
      cb.checkCooldown(Date.now() + 2 * 60 * 1000); // 2 minutes later
      expect(cb.state).toBe(CircuitBreakerState.HalfOpen);
      expect(cb.canExecute()).toBe(true);
    });

    it("should transition from HALF_OPEN to CLOSED on success", () => {
      // Trip and cooldown
      for (let i = 0; i < 3; i++) {
        cb.recordIteration({ filesModified: 0, error: null, testsPass: true });
      }
      cb.checkCooldown(Date.now() + 2 * 60 * 1000);

      // Successful iteration
      cb.recordIteration({ filesModified: 2, error: null, testsPass: true });
      expect(cb.state).toBe(CircuitBreakerState.Closed);
    });

    it("should transition from HALF_OPEN to OPEN on failure", () => {
      // Trip and cooldown
      for (let i = 0; i < 3; i++) {
        cb.recordIteration({ filesModified: 0, error: null, testsPass: true });
      }
      cb.checkCooldown(Date.now() + 2 * 60 * 1000);

      // Failed iteration
      cb.recordIteration({ filesModified: 0, error: null, testsPass: true });
      expect(cb.state).toBe(CircuitBreakerState.Open);
    });
  });

  describe("manual reset", () => {
    it("should reset to CLOSED state", () => {
      for (let i = 0; i < 3; i++) {
        cb.recordIteration({ filesModified: 0, error: null, testsPass: true });
      }
      expect(cb.state).toBe(CircuitBreakerState.Open);

      cb.reset();
      expect(cb.state).toBe(CircuitBreakerState.Closed);
      expect(cb.stats.noProgressCount).toBe(0);
      expect(cb.stats.sameErrorCount).toBe(0);
    });
  });

  describe("auto reset", () => {
    it("should auto reset after cooldown when enabled", () => {
      const autoCb = new CircuitBreaker({ ...defaultCbConfig, autoReset: true });
      for (let i = 0; i < 3; i++) {
        autoCb.recordIteration({
          filesModified: 0,
          error: null,
          testsPass: true,
        });
      }
      expect(autoCb.state).toBe(CircuitBreakerState.Open);

      autoCb.checkCooldown(Date.now() + 2 * 60 * 1000);
      // With autoReset, goes directly to CLOSED
      expect(autoCb.state).toBe(
        autoCb.config.autoReset
          ? CircuitBreakerState.HalfOpen
          : CircuitBreakerState.HalfOpen
      );
    });
  });

  describe("serialization", () => {
    it("should serialize state to JSON", () => {
      cb.recordIteration({ filesModified: 0, error: null, testsPass: true });
      const json = cb.toJSON();
      expect(json.state).toBe(CircuitBreakerState.Closed);
      expect(json.stats.noProgressCount).toBe(1);
    });

    it("should restore state from JSON", () => {
      cb.recordIteration({ filesModified: 0, error: null, testsPass: true });
      cb.recordIteration({ filesModified: 0, error: null, testsPass: true });
      const json = cb.toJSON();

      const restored = CircuitBreaker.fromJSON(json, defaultCbConfig);
      expect(restored.state).toBe(cb.state);
      expect(restored.stats.noProgressCount).toBe(2);
    });
  });
});
