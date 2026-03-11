import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  HookRegistry,
  HookEvent,
  type Hook,
  type HookContext,
} from "../../src/loop/hooks.js";

describe("Hook System", () => {
  let registry: HookRegistry;

  beforeEach(() => {
    registry = new HookRegistry();
  });

  describe("registration", () => {
    it("should register a hook", () => {
      const hook: Hook = {
        name: "pre-test",
        event: HookEvent.PreIteration,
        handler: vi.fn(),
      };
      registry.register(hook);
      expect(registry.list(HookEvent.PreIteration)).toHaveLength(1);
    });

    it("should register multiple hooks for same event", () => {
      registry.register({
        name: "hook-a",
        event: HookEvent.PreIteration,
        handler: vi.fn(),
      });
      registry.register({
        name: "hook-b",
        event: HookEvent.PreIteration,
        handler: vi.fn(),
      });
      expect(registry.list(HookEvent.PreIteration)).toHaveLength(2);
    });

    it("should reject duplicate hook names", () => {
      registry.register({
        name: "hook-a",
        event: HookEvent.PreIteration,
        handler: vi.fn(),
      });
      expect(() =>
        registry.register({
          name: "hook-a",
          event: HookEvent.PostIteration,
          handler: vi.fn(),
        })
      ).toThrow("already registered");
    });

    it("should unregister a hook", () => {
      registry.register({
        name: "removable",
        event: HookEvent.PreIteration,
        handler: vi.fn(),
      });
      registry.unregister("removable");
      expect(registry.list(HookEvent.PreIteration)).toHaveLength(0);
    });
  });

  describe("execution", () => {
    it("should execute all hooks for an event", async () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      registry.register({
        name: "h1",
        event: HookEvent.PreIteration,
        handler: fn1,
      });
      registry.register({
        name: "h2",
        event: HookEvent.PreIteration,
        handler: fn2,
      });

      const ctx: HookContext = { iteration: 1, phase: "testing" };
      await registry.execute(HookEvent.PreIteration, ctx);

      expect(fn1).toHaveBeenCalledWith(ctx);
      expect(fn2).toHaveBeenCalledWith(ctx);
    });

    it("should execute hooks in registration order", async () => {
      const order: string[] = [];
      registry.register({
        name: "first",
        event: HookEvent.PreIteration,
        handler: async () => { order.push("first"); },
      });
      registry.register({
        name: "second",
        event: HookEvent.PreIteration,
        handler: async () => { order.push("second"); },
      });

      await registry.execute(HookEvent.PreIteration, { iteration: 1, phase: "idle" });
      expect(order).toEqual(["first", "second"]);
    });

    it("should not execute hooks for other events", async () => {
      const fn = vi.fn();
      registry.register({
        name: "post-only",
        event: HookEvent.PostIteration,
        handler: fn,
      });

      await registry.execute(HookEvent.PreIteration, { iteration: 1, phase: "idle" });
      expect(fn).not.toHaveBeenCalled();
    });

    it("should catch and report hook errors without stopping", async () => {
      const failingHook = vi.fn().mockRejectedValue(new Error("Hook failed"));
      const successHook = vi.fn();

      registry.register({
        name: "failing",
        event: HookEvent.PreIteration,
        handler: failingHook,
      });
      registry.register({
        name: "success",
        event: HookEvent.PreIteration,
        handler: successHook,
      });

      const errors = await registry.execute(HookEvent.PreIteration, {
        iteration: 1,
        phase: "idle",
      });

      expect(errors).toHaveLength(1);
      expect(errors[0]?.hookName).toBe("failing");
      expect(successHook).toHaveBeenCalled();
    });
  });

  describe("event types", () => {
    it("should support all lifecycle events", () => {
      expect(Object.values(HookEvent)).toContain("pre_iteration");
      expect(Object.values(HookEvent)).toContain("post_iteration");
      expect(Object.values(HookEvent)).toContain("pre_commit");
      expect(Object.values(HookEvent)).toContain("post_commit");
      expect(Object.values(HookEvent)).toContain("on_error");
      expect(Object.values(HookEvent)).toContain("on_complete");
      expect(Object.values(HookEvent)).toContain("pre_quality_gate");
      expect(Object.values(HookEvent)).toContain("post_quality_gate");
    });
  });
});
