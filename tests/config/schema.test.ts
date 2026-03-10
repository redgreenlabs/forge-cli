import { describe, it, expect } from "vitest";
import {
  ForgeConfigSchema,
  defaultConfig,
  type ForgeConfig,
  AgentRole,
  QualityGateSeverity,
} from "../../src/config/schema.js";

describe("ForgeConfigSchema", () => {
  describe("default config", () => {
    it("should provide valid default configuration", () => {
      const result = ForgeConfigSchema.safeParse(defaultConfig);
      expect(result.success).toBe(true);
    });

    it("should have sensible default values", () => {
      expect(defaultConfig.maxIterations).toBe(50);
      expect(defaultConfig.maxCallsPerHour).toBe(100);
      expect(defaultConfig.timeoutMinutes).toBe(15);
      expect(defaultConfig.tdd.enabled).toBe(true);
      expect(defaultConfig.security.enabled).toBe(true);
      expect(defaultConfig.coverage.lineThreshold).toBe(80);
    });
  });

  describe("validation", () => {
    it("should reject negative maxIterations", () => {
      const result = ForgeConfigSchema.safeParse({
        ...defaultConfig,
        maxIterations: -1,
      });
      expect(result.success).toBe(false);
    });

    it("should reject maxCallsPerHour of zero", () => {
      const result = ForgeConfigSchema.safeParse({
        ...defaultConfig,
        maxCallsPerHour: 0,
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid coverage thresholds", () => {
      const result = ForgeConfigSchema.safeParse({
        ...defaultConfig,
        coverage: { ...defaultConfig.coverage, lineThreshold: 101 },
      });
      expect(result.success).toBe(false);
    });

    it("should reject coverage thresholds below 0", () => {
      const result = ForgeConfigSchema.safeParse({
        ...defaultConfig,
        coverage: { ...defaultConfig.coverage, branchThreshold: -5 },
      });
      expect(result.success).toBe(false);
    });

    it("should accept valid custom configuration", () => {
      const customConfig: ForgeConfig = {
        ...defaultConfig,
        maxIterations: 100,
        maxCallsPerHour: 50,
        agents: {
          ...defaultConfig.agents,
          team: [AgentRole.Implementer, AgentRole.Tester],
        },
      };
      const result = ForgeConfigSchema.safeParse(customConfig);
      expect(result.success).toBe(true);
    });

    it("should reject empty agent team", () => {
      const result = ForgeConfigSchema.safeParse({
        ...defaultConfig,
        agents: { ...defaultConfig.agents, team: [] },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("agent roles", () => {
    it("should enumerate all agent roles", () => {
      expect(Object.values(AgentRole)).toContain("architect");
      expect(Object.values(AgentRole)).toContain("implementer");
      expect(Object.values(AgentRole)).toContain("tester");
      expect(Object.values(AgentRole)).toContain("reviewer");
      expect(Object.values(AgentRole)).toContain("security");
      expect(Object.values(AgentRole)).toContain("documenter");
    });
  });

  describe("quality gate severities", () => {
    it("should have block and warn severities", () => {
      expect(Object.values(QualityGateSeverity)).toContain("block");
      expect(Object.values(QualityGateSeverity)).toContain("warn");
    });
  });

  describe("circuit breaker config", () => {
    it("should validate circuit breaker thresholds", () => {
      const result = ForgeConfigSchema.safeParse({
        ...defaultConfig,
        circuitBreaker: {
          noProgressThreshold: 0,
          sameErrorThreshold: 5,
          cooldownMinutes: 30,
          autoReset: false,
        },
      });
      expect(result.success).toBe(false);
    });

    it("should accept valid circuit breaker config", () => {
      const result = ForgeConfigSchema.safeParse({
        ...defaultConfig,
        circuitBreaker: {
          noProgressThreshold: 5,
          sameErrorThreshold: 3,
          cooldownMinutes: 15,
          autoReset: true,
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("security config", () => {
    it("should validate security severity levels", () => {
      const result = ForgeConfigSchema.safeParse({
        ...defaultConfig,
        security: {
          ...defaultConfig.security,
          blockOnSeverity: "invalid" as any,
        },
      });
      expect(result.success).toBe(false);
    });
  });
});
