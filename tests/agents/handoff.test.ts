import { describe, it, expect, beforeEach } from "vitest";
import {
  HandoffContext,
  HandoffEntry,
  HandoffPriority,
} from "../../src/agents/handoff.js";
import { AgentRole } from "../../src/config/schema.js";

describe("Agent Handoff Protocol", () => {
  let ctx: HandoffContext;

  beforeEach(() => {
    ctx = new HandoffContext();
  });

  describe("adding entries", () => {
    it("should add a handoff entry", () => {
      ctx.add({
        from: AgentRole.Architect,
        to: AgentRole.Implementer,
        summary: "Implement user authentication module",
        artifacts: ["src/auth/schema.ts"],
        priority: HandoffPriority.High,
      });
      expect(ctx.entries).toHaveLength(1);
    });

    it("should track from/to roles", () => {
      ctx.add({
        from: AgentRole.Tester,
        to: AgentRole.Implementer,
        summary: "Fix failing login test",
        artifacts: [],
        priority: HandoffPriority.Normal,
      });
      const entry = ctx.entries[0]!;
      expect(entry.from).toBe(AgentRole.Tester);
      expect(entry.to).toBe(AgentRole.Implementer);
    });

    it("should auto-assign timestamp", () => {
      ctx.add({
        from: AgentRole.Architect,
        to: AgentRole.Implementer,
        summary: "Build API layer",
        artifacts: [],
        priority: HandoffPriority.Normal,
      });
      expect(ctx.entries[0]!.timestamp).toBeGreaterThan(0);
    });

    it("should support artifacts list", () => {
      ctx.add({
        from: AgentRole.Architect,
        to: AgentRole.Implementer,
        summary: "Implement DB schema",
        artifacts: ["src/db/schema.sql", "src/db/migrations/001.ts"],
        priority: HandoffPriority.High,
      });
      expect(ctx.entries[0]!.artifacts).toEqual([
        "src/db/schema.sql",
        "src/db/migrations/001.ts",
      ]);
    });
  });

  describe("querying entries", () => {
    beforeEach(() => {
      ctx.add({
        from: AgentRole.Architect,
        to: AgentRole.Implementer,
        summary: "Build auth module",
        artifacts: ["auth.ts"],
        priority: HandoffPriority.High,
      });
      ctx.add({
        from: AgentRole.Tester,
        to: AgentRole.Implementer,
        summary: "Fix test regression",
        artifacts: [],
        priority: HandoffPriority.Critical,
      });
      ctx.add({
        from: AgentRole.Reviewer,
        to: AgentRole.Implementer,
        summary: "Refactor naming",
        artifacts: [],
        priority: HandoffPriority.Low,
      });
      ctx.add({
        from: AgentRole.Architect,
        to: AgentRole.Tester,
        summary: "Write integration tests for API",
        artifacts: [],
        priority: HandoffPriority.Normal,
      });
    });

    it("should filter entries by target role", () => {
      const forImpl = ctx.forAgent(AgentRole.Implementer);
      expect(forImpl).toHaveLength(3);
    });

    it("should return entries sorted by priority (critical first)", () => {
      const forImpl = ctx.forAgent(AgentRole.Implementer);
      expect(forImpl[0]!.priority).toBe(HandoffPriority.Critical);
      expect(forImpl[1]!.priority).toBe(HandoffPriority.High);
      expect(forImpl[2]!.priority).toBe(HandoffPriority.Low);
    });

    it("should filter entries from a specific agent", () => {
      const fromArch = ctx.fromAgent(AgentRole.Architect);
      expect(fromArch).toHaveLength(2);
    });
  });

  describe("context summary", () => {
    it("should generate a prompt-friendly summary for an agent", () => {
      ctx.add({
        from: AgentRole.Architect,
        to: AgentRole.Implementer,
        summary: "Build the user service with CRUD operations",
        artifacts: ["src/services/user.ts"],
        priority: HandoffPriority.High,
      });
      const summary = ctx.buildPromptFor(AgentRole.Implementer);
      expect(summary).toContain("Build the user service");
      expect(summary).toContain("Architect");
      expect(summary).toContain("src/services/user.ts");
    });

    it("should return empty string when no entries exist for agent", () => {
      const summary = ctx.buildPromptFor(AgentRole.Documenter);
      expect(summary).toBe("");
    });
  });

  describe("conflict resolution", () => {
    it("should detect conflicting instructions for the same agent", () => {
      ctx.add({
        from: AgentRole.Architect,
        to: AgentRole.Implementer,
        summary: "Use SQL database for persistence",
        artifacts: [],
        priority: HandoffPriority.High,
      });
      ctx.add({
        from: AgentRole.Reviewer,
        to: AgentRole.Implementer,
        summary: "Use NoSQL database for persistence",
        artifacts: [],
        priority: HandoffPriority.High,
      });
      const conflicts = ctx.detectConflicts(AgentRole.Implementer);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.entries).toHaveLength(2);
    });

    it("should not flag non-conflicting entries", () => {
      ctx.add({
        from: AgentRole.Architect,
        to: AgentRole.Implementer,
        summary: "Build auth module",
        artifacts: [],
        priority: HandoffPriority.High,
      });
      ctx.add({
        from: AgentRole.Tester,
        to: AgentRole.Implementer,
        summary: "Write unit tests for auth",
        artifacts: [],
        priority: HandoffPriority.Normal,
      });
      const conflicts = ctx.detectConflicts(AgentRole.Implementer);
      expect(conflicts).toHaveLength(0);
    });
  });

  describe("serialization", () => {
    it("should serialize to JSON", () => {
      ctx.add({
        from: AgentRole.Architect,
        to: AgentRole.Implementer,
        summary: "Build API",
        artifacts: ["api.ts"],
        priority: HandoffPriority.Normal,
      });
      const json = ctx.toJSON();
      expect(json.entries).toHaveLength(1);
      expect(json.entries[0]!.summary).toBe("Build API");
    });

    it("should restore from JSON", () => {
      ctx.add({
        from: AgentRole.Tester,
        to: AgentRole.Security,
        summary: "Review auth flow",
        artifacts: [],
        priority: HandoffPriority.Critical,
      });
      const json = ctx.toJSON();
      const restored = HandoffContext.fromJSON(json);
      expect(restored.entries).toHaveLength(1);
      expect(restored.entries[0]!.from).toBe(AgentRole.Tester);
      expect(restored.entries[0]!.priority).toBe(HandoffPriority.Critical);
    });
  });
});
