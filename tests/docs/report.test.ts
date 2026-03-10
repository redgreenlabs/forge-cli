import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  generateReport,
  type ReportData,
  type ReportFormat,
} from "../../src/docs/report.js";

describe("Health Report", () => {
  const sampleData: ReportData = {
    projectName: "test-project",
    generatedAt: "2026-03-10T12:00:00Z",
    sessions: {
      total: 5,
      totalIterations: 42,
      averageIterationsPerSession: 8.4,
    },
    tests: {
      total: 150,
      passed: 148,
      failed: 2,
      coverage: {
        lines: 92.5,
        branches: 85.3,
        functions: 95.0,
      },
    },
    security: {
      findings: { critical: 0, high: 1, medium: 3, low: 5 },
      lastScanAt: "2026-03-10T11:55:00Z",
      secretsDetected: 0,
    },
    commits: {
      total: 28,
      byType: {
        feat: 10,
        fix: 6,
        test: 5,
        docs: 3,
        refactor: 2,
        security: 1,
        chore: 1,
      },
      conventionalRate: 96.4,
    },
    qualityGates: {
      totalRuns: 42,
      passRate: 88.1,
      mostFailedGate: "coverage-threshold",
    },
    tdd: {
      cyclesCompleted: 15,
      violations: 2,
    },
  };

  describe("generateReport - terminal format", () => {
    it("should include project name", () => {
      const report = generateReport(sampleData, "terminal");
      expect(report).toContain("test-project");
    });

    it("should include test results", () => {
      const report = generateReport(sampleData, "terminal");
      expect(report).toContain("148");
      expect(report).toContain("150");
    });

    it("should include coverage numbers", () => {
      const report = generateReport(sampleData, "terminal");
      expect(report).toContain("92.5%");
    });

    it("should include security findings", () => {
      const report = generateReport(sampleData, "terminal");
      expect(report).toContain("1 HIGH");
    });

    it("should include commit statistics", () => {
      const report = generateReport(sampleData, "terminal");
      expect(report).toContain("28");
      expect(report).toContain("96.4%");
    });

    it("should include TDD metrics", () => {
      const report = generateReport(sampleData, "terminal");
      expect(report).toContain("15");
    });

    it("should include quality gate pass rate", () => {
      const report = generateReport(sampleData, "terminal");
      expect(report).toContain("88.1%");
    });
  });

  describe("generateReport - json format", () => {
    it("should return valid JSON", () => {
      const report = generateReport(sampleData, "json");
      const parsed = JSON.parse(report);
      expect(parsed.projectName).toBe("test-project");
    });

    it("should include all sections", () => {
      const report = generateReport(sampleData, "json");
      const parsed = JSON.parse(report);
      expect(parsed.tests).toBeDefined();
      expect(parsed.security).toBeDefined();
      expect(parsed.commits).toBeDefined();
      expect(parsed.tdd).toBeDefined();
    });
  });

  describe("generateReport - html format", () => {
    it("should return valid HTML", () => {
      const report = generateReport(sampleData, "html");
      expect(report).toContain("<!DOCTYPE html>");
      expect(report).toContain("test-project");
      expect(report).toContain("</html>");
    });

    it("should include styled sections", () => {
      const report = generateReport(sampleData, "html");
      expect(report).toContain("Tests");
      expect(report).toContain("Security");
      expect(report).toContain("Coverage");
    });
  });
});
