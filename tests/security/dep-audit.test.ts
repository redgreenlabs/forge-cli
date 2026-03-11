import { describe, it, expect } from "vitest";
import {
  parseNpmAudit,
  parsePipAudit,
  parseCargoAudit,
  DepVulnerability,
  DepSeverity,
  type AuditResult,
} from "../../src/security/dep-audit.js";

describe("Dependency Audit", () => {
  describe("parseNpmAudit", () => {
    it("should parse npm audit JSON output with vulnerabilities", () => {
      const npmOutput = JSON.stringify({
        vulnerabilities: {
          lodash: {
            name: "lodash",
            severity: "high",
            via: [
              {
                title: "Prototype Pollution",
                url: "https://github.com/advisories/GHSA-1234",
                severity: "high",
                range: "<4.17.21",
              },
            ],
            fixAvailable: { name: "lodash", version: "4.17.21" },
          },
          minimist: {
            name: "minimist",
            severity: "critical",
            via: [
              {
                title: "Prototype Pollution",
                url: "https://github.com/advisories/GHSA-5678",
                severity: "critical",
                range: "<1.2.6",
              },
            ],
            fixAvailable: true,
          },
        },
        metadata: {
          vulnerabilities: {
            info: 0,
            low: 0,
            moderate: 0,
            high: 1,
            critical: 1,
            total: 2,
          },
        },
      });

      const result = parseNpmAudit(npmOutput);
      expect(result.vulnerabilities).toHaveLength(2);
      expect(result.vulnerabilities[0]!.package).toBe("lodash");
      expect(result.vulnerabilities[0]!.severity).toBe(DepSeverity.High);
      expect(result.vulnerabilities[0]!.title).toBe("Prototype Pollution");
      expect(result.summary.total).toBe(2);
      expect(result.summary.critical).toBe(1);
    });

    it("should handle clean npm audit output", () => {
      const npmOutput = JSON.stringify({
        vulnerabilities: {},
        metadata: {
          vulnerabilities: {
            info: 0,
            low: 0,
            moderate: 0,
            high: 0,
            critical: 0,
            total: 0,
          },
        },
      });

      const result = parseNpmAudit(npmOutput);
      expect(result.vulnerabilities).toHaveLength(0);
      expect(result.summary.total).toBe(0);
    });

    it("should handle malformed npm audit output gracefully", () => {
      const result = parseNpmAudit("not json at all");
      expect(result.vulnerabilities).toHaveLength(0);
      expect(result.error).toBeTruthy();
    });

    it("should map npm severity levels correctly", () => {
      const npmOutput = JSON.stringify({
        vulnerabilities: {
          a: {
            name: "a",
            severity: "low",
            via: [{ title: "A", severity: "low", range: "*" }],
          },
          b: {
            name: "b",
            severity: "moderate",
            via: [{ title: "B", severity: "moderate", range: "*" }],
          },
          c: {
            name: "c",
            severity: "info",
            via: [{ title: "C", severity: "info", range: "*" }],
          },
        },
        metadata: {
          vulnerabilities: { info: 1, low: 1, moderate: 1, high: 0, critical: 0, total: 3 },
        },
      });

      const result = parseNpmAudit(npmOutput);
      expect(result.vulnerabilities[0]!.severity).toBe(DepSeverity.Low);
      expect(result.vulnerabilities[1]!.severity).toBe(DepSeverity.Moderate);
      expect(result.vulnerabilities[2]!.severity).toBe(DepSeverity.Info);
    });
  });

  describe("parsePipAudit", () => {
    it("should parse pip-audit JSON output", () => {
      const pipOutput = JSON.stringify([
        {
          name: "django",
          version: "3.2.0",
          vulns: [
            {
              id: "PYSEC-2021-123",
              fix_versions: ["3.2.1"],
              description: "SQL injection in QuerySet",
            },
          ],
        },
      ]);

      const result = parsePipAudit(pipOutput);
      expect(result.vulnerabilities).toHaveLength(1);
      expect(result.vulnerabilities[0]!.package).toBe("django");
      expect(result.vulnerabilities[0]!.currentVersion).toBe("3.2.0");
      expect(result.vulnerabilities[0]!.fixVersion).toBe("3.2.1");
    });

    it("should handle empty pip-audit output", () => {
      const result = parsePipAudit("[]");
      expect(result.vulnerabilities).toHaveLength(0);
    });

    it("should handle malformed pip-audit output", () => {
      const result = parsePipAudit("ERROR: not json");
      expect(result.vulnerabilities).toHaveLength(0);
      expect(result.error).toBeTruthy();
    });
  });

  describe("parseCargoAudit", () => {
    it("should parse cargo-audit JSON output", () => {
      const cargoOutput = JSON.stringify({
        vulnerabilities: {
          list: [
            {
              advisory: {
                id: "RUSTSEC-2021-0001",
                title: "Memory safety issue",
                package: "smallvec",
                severity: "high",
              },
              versions: {
                patched: ["1.6.1"],
              },
            },
          ],
          count: 1,
        },
      });

      const result = parseCargoAudit(cargoOutput);
      expect(result.vulnerabilities).toHaveLength(1);
      expect(result.vulnerabilities[0]!.package).toBe("smallvec");
      expect(result.vulnerabilities[0]!.title).toBe("Memory safety issue");
      expect(result.vulnerabilities[0]!.fixVersion).toBe("1.6.1");
    });

    it("should handle clean cargo-audit output", () => {
      const cargoOutput = JSON.stringify({
        vulnerabilities: { list: [], count: 0 },
      });
      const result = parseCargoAudit(cargoOutput);
      expect(result.vulnerabilities).toHaveLength(0);
    });

    it("should handle malformed cargo-audit output", () => {
      const result = parseCargoAudit("error: something went wrong");
      expect(result.vulnerabilities).toHaveLength(0);
      expect(result.error).toBeTruthy();
    });
  });

  describe("AuditResult", () => {
    it("should indicate blocking when critical/high findings exist", () => {
      const npmOutput = JSON.stringify({
        vulnerabilities: {
          pkg: {
            name: "pkg",
            severity: "critical",
            via: [{ title: "Bad", severity: "critical", range: "*" }],
          },
        },
        metadata: {
          vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 1, total: 1 },
        },
      });

      const result = parseNpmAudit(npmOutput);
      expect(result.shouldBlock("high")).toBe(true);
    });

    it("should not block when only low/moderate findings exist", () => {
      const npmOutput = JSON.stringify({
        vulnerabilities: {
          pkg: {
            name: "pkg",
            severity: "low",
            via: [{ title: "Minor", severity: "low", range: "*" }],
          },
        },
        metadata: {
          vulnerabilities: { info: 0, low: 1, moderate: 0, high: 0, critical: 0, total: 1 },
        },
      });

      const result = parseNpmAudit(npmOutput);
      expect(result.shouldBlock("high")).toBe(false);
    });
  });
});
