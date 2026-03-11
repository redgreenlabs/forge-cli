import { describe, it, expect } from "vitest";
import {
  TeamComposer,
  TeamPreset,
  type TeamConfig,
} from "../../src/agents/team.js";
import { AgentRole } from "../../src/config/schema.js";

describe("Agent Team Composer", () => {
  describe("presets", () => {
    it("should create a default team with 4 core roles", () => {
      const team = TeamComposer.fromPreset(TeamPreset.Default);
      expect(team.roles).toEqual([
        AgentRole.Architect,
        AgentRole.Implementer,
        AgentRole.Tester,
        AgentRole.Reviewer,
      ]);
    });

    it("should create a full team with all 6 roles", () => {
      const team = TeamComposer.fromPreset(TeamPreset.Full);
      expect(team.roles).toHaveLength(6);
      expect(team.roles).toContain(AgentRole.Security);
      expect(team.roles).toContain(AgentRole.Documenter);
    });

    it("should create a solo team with only implementer", () => {
      const team = TeamComposer.fromPreset(TeamPreset.Solo);
      expect(team.roles).toEqual([AgentRole.Implementer]);
    });

    it("should create a security-focused team", () => {
      const team = TeamComposer.fromPreset(TeamPreset.SecurityFocused);
      expect(team.roles).toContain(AgentRole.Security);
      expect(team.roles).toContain(AgentRole.Implementer);
      expect(team.roles).toContain(AgentRole.Tester);
    });
  });

  describe("custom composition", () => {
    it("should create team from role list", () => {
      const team = TeamComposer.fromRoles([
        AgentRole.Implementer,
        AgentRole.Tester,
      ]);
      expect(team.roles).toEqual([AgentRole.Implementer, AgentRole.Tester]);
    });

    it("should deduplicate roles", () => {
      const team = TeamComposer.fromRoles([
        AgentRole.Implementer,
        AgentRole.Implementer,
        AgentRole.Tester,
      ]);
      expect(team.roles).toHaveLength(2);
    });

    it("should reject empty team", () => {
      expect(() => TeamComposer.fromRoles([])).toThrow("at least one role");
    });
  });

  describe("rotation", () => {
    it("should rotate through roles in order", () => {
      const team = TeamComposer.fromPreset(TeamPreset.Default);
      expect(team.nextRole(0)).toBe(AgentRole.Architect);
      expect(team.nextRole(1)).toBe(AgentRole.Implementer);
      expect(team.nextRole(2)).toBe(AgentRole.Tester);
      expect(team.nextRole(3)).toBe(AgentRole.Reviewer);
    });

    it("should wrap around after all roles used", () => {
      const team = TeamComposer.fromPreset(TeamPreset.Default);
      expect(team.nextRole(4)).toBe(AgentRole.Architect);
    });

    it("should respect solo mode", () => {
      const team = TeamComposer.fromPreset(TeamPreset.Solo);
      expect(team.nextRole(0)).toBe(AgentRole.Implementer);
      expect(team.nextRole(5)).toBe(AgentRole.Implementer);
    });
  });

  describe("pipeline", () => {
    it("should define iteration pipeline (which roles run per iteration)", () => {
      const team = TeamComposer.fromPreset(TeamPreset.Default);
      const pipeline = team.iterationPipeline();
      expect(pipeline).toEqual([
        AgentRole.Architect,
        AgentRole.Implementer,
        AgentRole.Tester,
        AgentRole.Reviewer,
      ]);
    });

    it("should put security after tester when in team", () => {
      const team = TeamComposer.fromPreset(TeamPreset.Full);
      const pipeline = team.iterationPipeline();
      const testerIdx = pipeline.indexOf(AgentRole.Tester);
      const secIdx = pipeline.indexOf(AgentRole.Security);
      expect(secIdx).toBeGreaterThan(testerIdx);
    });

    it("should put documenter last", () => {
      const team = TeamComposer.fromPreset(TeamPreset.Full);
      const pipeline = team.iterationPipeline();
      expect(pipeline[pipeline.length - 1]).toBe(AgentRole.Documenter);
    });
  });

  describe("config integration", () => {
    it("should create team from ForgeConfig agents section", () => {
      const team = TeamComposer.fromConfig({
        team: [AgentRole.Implementer, AgentRole.Tester],
        soloMode: false,
      });
      expect(team.roles).toHaveLength(2);
    });

    it("should use solo mode when configured", () => {
      const team = TeamComposer.fromConfig({
        team: [AgentRole.Implementer, AgentRole.Tester, AgentRole.Reviewer],
        soloMode: true,
      });
      // In solo mode, only the first role is used
      expect(team.roles).toHaveLength(1);
    });
  });
});
