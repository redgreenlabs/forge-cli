import { describe, it, expect, vi } from "vitest";
import {
  createDepAuditGate,
} from "../../src/gates/dep-audit-gate.js";
import { QualityGateSeverity } from "../../src/config/schema.js";

describe("Dependency Audit Gate", () => {
  it("should create a gate plugin", () => {
    const gate = createDepAuditGate({
      projectRoot: "/project",
      packageManager: "npm",
      blockOnSeverity: "high",
    });
    expect(gate.name).toBe("dependency-audit");
    expect(gate.severity).toBe(QualityGateSeverity.Block);
  });

  it("should pass when audit command succeeds", async () => {
    vi.doMock("child_process", () => ({
      execSync: vi.fn().mockReturnValue(JSON.stringify({
        vulnerabilities: {},
        metadata: {
          vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
        },
      })),
    }));

    const gate = createDepAuditGate({
      projectRoot: "/project",
      packageManager: "npm",
      blockOnSeverity: "high",
    });
    const result = await gate.check();
    expect(result.passed).toBe(true);

    vi.doUnmock("child_process");
  });

  it("should support pip package manager", () => {
    const gate = createDepAuditGate({
      projectRoot: "/project",
      packageManager: "pip",
      blockOnSeverity: "high",
    });
    expect(gate.name).toBe("dependency-audit");
    expect(gate.description).toContain("pip");
  });

  it("should support cargo package manager", () => {
    const gate = createDepAuditGate({
      projectRoot: "/project",
      packageManager: "cargo",
      blockOnSeverity: "critical",
    });
    expect(gate.description).toContain("cargo");
  });

  it("should handle missing audit tool gracefully", async () => {
    vi.doMock("child_process", () => ({
      execSync: vi.fn().mockImplementation(() => {
        throw new Error("command not found: npm");
      }),
    }));

    const gate = createDepAuditGate({
      projectRoot: "/project",
      packageManager: "npm",
      blockOnSeverity: "high",
    });
    const result = await gate.check();
    // Should not crash, returns a warning
    expect(result.passed).toBe(false);

    vi.doUnmock("child_process");
  });
});
