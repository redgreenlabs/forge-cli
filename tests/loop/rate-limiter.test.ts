import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  RateLimiter,
  type RateLimiterSnapshot,
} from "../../src/loop/rate-limiter.js";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter(10, 60_000); // 10 calls per 60s
  });

  describe("basic tracking", () => {
    it("should start with zero calls", () => {
      expect(limiter.callCount).toBe(0);
      expect(limiter.remaining).toBe(10);
    });

    it("should increment call count", () => {
      limiter.record();
      limiter.record();
      expect(limiter.callCount).toBe(2);
      expect(limiter.remaining).toBe(8);
    });

    it("should allow calls within limit", () => {
      for (let i = 0; i < 9; i++) limiter.record();
      expect(limiter.canProceed()).toBe(true);
    });

    it("should block when limit reached", () => {
      for (let i = 0; i < 10; i++) limiter.record();
      expect(limiter.canProceed()).toBe(false);
      expect(limiter.remaining).toBe(0);
    });
  });

  describe("window reset", () => {
    it("should reset after window elapses", () => {
      for (let i = 0; i < 10; i++) limiter.record();
      expect(limiter.canProceed()).toBe(false);

      // Simulate window elapsed
      limiter.checkWindow(Date.now() + 61_000);
      expect(limiter.canProceed()).toBe(true);
      expect(limiter.callCount).toBe(0);
    });

    it("should not reset within window", () => {
      limiter.record();
      limiter.checkWindow(Date.now() + 30_000);
      expect(limiter.callCount).toBe(1);
    });
  });

  describe("time until reset", () => {
    it("should report milliseconds until window resets", () => {
      limiter.record();
      const ms = limiter.msUntilReset();
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(60_000);
    });

    it("should return 0 when no calls made", () => {
      expect(limiter.msUntilReset()).toBe(0);
    });
  });

  describe("serialization", () => {
    it("should serialize to snapshot", () => {
      limiter.record();
      limiter.record();
      const snap = limiter.toJSON();
      expect(snap.callCount).toBe(2);
      expect(snap.maxCalls).toBe(10);
    });

    it("should restore from snapshot", () => {
      limiter.record();
      limiter.record();
      limiter.record();
      const snap = limiter.toJSON();

      const restored = RateLimiter.fromJSON(snap);
      expect(restored.callCount).toBe(3);
      expect(restored.remaining).toBe(7);
    });
  });

  describe("hourly convenience constructor", () => {
    it("should create limiter with 1-hour window", () => {
      const hourly = RateLimiter.perHour(100);
      expect(hourly.remaining).toBe(100);
    });
  });
});
