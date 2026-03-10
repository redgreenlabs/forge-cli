import { describe, it, expect } from "vitest";
import {
  QualityGatePipeline,
  type GateResult,
  GateStatus,
  type QualityGateDefinition,
} from "../../src/gates/quality-gates.js";
import { QualityGateSeverity } from "../../src/config/schema.js";

describe("QualityGatePipeline", () => {
  describe("gate execution", () => {
    it("should pass when all gates succeed", async () => {
      const gates: QualityGateDefinition[] = [
        {
          name: "tests",
          severity: QualityGateSeverity.Block,
          check: async () => ({ passed: true, message: "All tests pass" }),
        },
        {
          name: "coverage",
          severity: QualityGateSeverity.Block,
          check: async () => ({ passed: true, message: "Coverage at 85%" }),
        },
      ];
      const pipeline = new QualityGatePipeline(gates);
      const result = await pipeline.run();

      expect(result.passed).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.results.every((r) => r.status === GateStatus.Passed)).toBe(
        true
      );
    });

    it("should fail when a blocking gate fails", async () => {
      const gates: QualityGateDefinition[] = [
        {
          name: "tests",
          severity: QualityGateSeverity.Block,
          check: async () => ({ passed: false, message: "3 tests failing" }),
        },
      ];
      const pipeline = new QualityGatePipeline(gates);
      const result = await pipeline.run();

      expect(result.passed).toBe(false);
      expect(result.results[0]?.status).toBe(GateStatus.Failed);
    });

    it("should pass with warnings when warn-level gate fails", async () => {
      const gates: QualityGateDefinition[] = [
        {
          name: "linting",
          severity: QualityGateSeverity.Warn,
          check: async () => ({
            passed: false,
            message: "5 linting warnings",
          }),
        },
      ];
      const pipeline = new QualityGatePipeline(gates);
      const result = await pipeline.run();

      expect(result.passed).toBe(true);
      expect(result.results[0]?.status).toBe(GateStatus.Warning);
    });

    it("should run all gates even if one fails", async () => {
      const gates: QualityGateDefinition[] = [
        {
          name: "tests",
          severity: QualityGateSeverity.Block,
          check: async () => ({ passed: false, message: "Failed" }),
        },
        {
          name: "coverage",
          severity: QualityGateSeverity.Block,
          check: async () => ({ passed: true, message: "OK" }),
        },
        {
          name: "security",
          severity: QualityGateSeverity.Block,
          check: async () => ({ passed: false, message: "Vulns found" }),
        },
      ];
      const pipeline = new QualityGatePipeline(gates);
      const result = await pipeline.run();

      expect(result.results).toHaveLength(3);
      expect(result.passed).toBe(false);
    });
  });

  describe("gate error handling", () => {
    it("should handle gate check throwing an error", async () => {
      const gates: QualityGateDefinition[] = [
        {
          name: "broken-gate",
          severity: QualityGateSeverity.Block,
          check: async () => {
            throw new Error("Gate crashed");
          },
        },
      ];
      const pipeline = new QualityGatePipeline(gates);
      const result = await pipeline.run();

      expect(result.passed).toBe(false);
      expect(result.results[0]?.status).toBe(GateStatus.Error);
      expect(result.results[0]?.message).toContain("Gate crashed");
    });
  });

  describe("gate timing", () => {
    it("should record execution time for each gate", async () => {
      const gates: QualityGateDefinition[] = [
        {
          name: "slow-gate",
          severity: QualityGateSeverity.Block,
          check: async () => {
            await new Promise((r) => setTimeout(r, 50));
            return { passed: true, message: "OK" };
          },
        },
      ];
      const pipeline = new QualityGatePipeline(gates);
      const result = await pipeline.run();

      expect(result.results[0]?.durationMs).toBeGreaterThanOrEqual(40);
    });
  });

  describe("pipeline summary", () => {
    it("should count passed, failed, and warning gates", async () => {
      const gates: QualityGateDefinition[] = [
        {
          name: "a",
          severity: QualityGateSeverity.Block,
          check: async () => ({ passed: true, message: "" }),
        },
        {
          name: "b",
          severity: QualityGateSeverity.Block,
          check: async () => ({ passed: false, message: "" }),
        },
        {
          name: "c",
          severity: QualityGateSeverity.Warn,
          check: async () => ({ passed: false, message: "" }),
        },
      ];
      const pipeline = new QualityGatePipeline(gates);
      const result = await pipeline.run();

      expect(result.summary.passed).toBe(1);
      expect(result.summary.failed).toBe(1);
      expect(result.summary.warnings).toBe(1);
      expect(result.summary.total).toBe(3);
    });
  });
});
