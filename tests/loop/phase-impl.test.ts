import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import {
  scanFilesForSecurity,
  runQualityGates,
  commitPhase,
} from "../../src/loop/phase-impl.js";
import { TddPhase } from "../../src/tdd/enforcer.js";
import { QualityGateSeverity } from "../../src/config/schema.js";
import type { QualityGateDefinition } from "../../src/gates/quality-gates.js";

describe("scanFilesForSecurity", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-security-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should return passed=true for clean files", () => {
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src/app.ts"),
      'const x = 42;\nexport function hello() { return "world"; }\n'
    );

    const result = scanFilesForSecurity(["src/app.ts"], tmpDir);
    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it("should detect hardcoded secrets", () => {
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src/config.ts"),
      'const key = "AKIAIOSFODNN7EXAMPLE";\n'
    );

    const result = scanFilesForSecurity(["src/config.ts"], tmpDir);
    expect(result.passed).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0]!.message).toContain("[secret]");
    expect(result.findings[0]!.severity).toBe("critical");
  });

  it("should detect SAST vulnerabilities", () => {
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src/query.ts"),
      'const query = "SELECT * FROM users WHERE id=" + userId;\n'
    );

    const result = scanFilesForSecurity(["src/query.ts"], tmpDir);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.message.includes("[vuln]"))).toBe(
      true
    );
  });

  it("should skip files that cannot be read", () => {
    const result = scanFilesForSecurity(
      ["nonexistent/file.ts"],
      tmpDir
    );
    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it("should pass when only medium/high findings (no critical)", () => {
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    // password assignment is "high" severity, not critical
    writeFileSync(
      join(tmpDir, "src/db.ts"),
      'const password = "mysecretpassword123";\n'
    );

    const result = scanFilesForSecurity(["src/db.ts"], tmpDir);
    // High severity doesn't block — only critical does
    expect(result.passed).toBe(true);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("should scan multiple files and aggregate findings", () => {
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src/a.ts"),
      'const key = "AKIAIOSFODNN7EXAMPLE";\n'
    );
    writeFileSync(
      join(tmpDir, "src/b.ts"),
      'const q = "SELECT * FROM t WHERE id=" + x;\n'
    );

    const result = scanFilesForSecurity(
      ["src/a.ts", "src/b.ts"],
      tmpDir
    );
    expect(result.findings.length).toBeGreaterThanOrEqual(2);
    expect(result.findings.some((f) => f.message.includes("[secret]"))).toBe(
      true
    );
    expect(result.findings.some((f) => f.message.includes("[vuln]"))).toBe(
      true
    );
  });
});

describe("runQualityGates", () => {
  it("should return passed=true when all gates pass", async () => {
    const gates: QualityGateDefinition[] = [
      {
        name: "always-pass",
        severity: QualityGateSeverity.Block,
        check: async () => ({ passed: true, message: "OK" }),
      },
    ];

    const result = await runQualityGates(gates);
    expect(result.passed).toBe(true);
    expect(result.summary.passed).toBe(1);
    expect(result.summary.failed).toBe(0);
  });

  it("should return passed=false when a blocking gate fails", async () => {
    const gates: QualityGateDefinition[] = [
      {
        name: "blocker",
        severity: QualityGateSeverity.Block,
        check: async () => ({ passed: false, message: "Tests fail" }),
      },
    ];

    const result = await runQualityGates(gates);
    expect(result.passed).toBe(false);
    expect(result.summary.failed).toBe(1);
  });

  it("should return passed=true when only warning gates fail", async () => {
    const gates: QualityGateDefinition[] = [
      {
        name: "lint-warn",
        severity: QualityGateSeverity.Warn,
        check: async () => ({ passed: false, message: "Lint issues" }),
      },
    ];

    const result = await runQualityGates(gates);
    expect(result.passed).toBe(true);
    expect(result.summary.warnings).toBe(1);
  });

  it("should run multiple gates and aggregate results", async () => {
    const gates: QualityGateDefinition[] = [
      {
        name: "tests",
        severity: QualityGateSeverity.Block,
        check: async () => ({ passed: true, message: "All pass" }),
      },
      {
        name: "lint",
        severity: QualityGateSeverity.Warn,
        check: async () => ({ passed: false, message: "Warnings" }),
      },
      {
        name: "security",
        severity: QualityGateSeverity.Block,
        check: async () => ({ passed: true, message: "Clean" }),
      },
    ];

    const result = await runQualityGates(gates);
    expect(result.passed).toBe(true);
    expect(result.summary.total).toBe(3);
    expect(result.summary.passed).toBe(2);
    expect(result.summary.warnings).toBe(1);
  });

  it("should handle gate errors gracefully", async () => {
    const gates: QualityGateDefinition[] = [
      {
        name: "crash-gate",
        severity: QualityGateSeverity.Block,
        check: async () => {
          throw new Error("Gate crashed");
        },
      },
    ];

    const result = await runQualityGates(gates);
    expect(result.passed).toBe(false);
    expect(result.summary.errors).toBe(1);
  });
});

describe("commitPhase", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-commit-"));
    // Initialize a git repo
    execSync("git init", { cwd: tmpDir, stdio: "pipe" });
    execSync('git config user.email "test@test.com"', {
      cwd: tmpDir,
      stdio: "pipe",
    });
    execSync('git config user.name "Test"', {
      cwd: tmpDir,
      stdio: "pipe",
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should return committed=false when no files", async () => {
    const result = await commitPhase(
      TddPhase.Red,
      [],
      "Add login",
      tmpDir
    );
    expect(result.committed).toBe(false);
    expect(result.message).toBe("No source files changed");
  });

  it("should commit with correct type for Red phase", async () => {
    mkdirSync(join(tmpDir, "tests"), { recursive: true });
    writeFileSync(join(tmpDir, "tests/login.test.ts"), "test('login', () => {});");

    const result = await commitPhase(
      TddPhase.Red,
      ["tests/login.test.ts"],
      "Add login test",
      tmpDir
    );

    expect(result.committed).toBe(true);
    expect(result.message).toMatch(/^test/);

    // Verify git log
    const log = execSync("git log -1 --format=%s", {
      cwd: tmpDir,
      encoding: "utf-8",
    }).trim();
    expect(log).toMatch(/^test/);
  });

  it("should commit with correct type for Green phase", async () => {
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src/login.ts"), "export function login() {}");

    const result = await commitPhase(
      TddPhase.Green,
      ["src/login.ts"],
      "Implement login",
      tmpDir
    );

    expect(result.committed).toBe(true);
    expect(result.message).toMatch(/^feat/);
  });

  it("should commit with correct type for Refactor phase", async () => {
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src/login.ts"), "export function login() { return true; }");

    const result = await commitPhase(
      TddPhase.Refactor,
      ["src/login.ts"],
      "Clean up login",
      tmpDir
    );

    expect(result.committed).toBe(true);
    expect(result.message).toMatch(/^refactor/);
  });

  it("should include taskId in commit message footer", async () => {
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src/auth.ts"), "export const auth = true;");

    const result = await commitPhase(
      TddPhase.Green,
      ["src/auth.ts"],
      "Add auth",
      tmpDir,
      "task-42"
    );

    expect(result.committed).toBe(true);
    expect(result.message).toContain("task-42");
  });

  it("should return committed=false when no changes exist", async () => {
    // Create an initial commit so git has a HEAD
    writeFileSync(join(tmpDir, "README.md"), "# test");
    execSync("git add -A && git commit -m 'init'", { cwd: tmpDir, stdio: "pipe" });

    // Now try to commit with no new changes
    const result = await commitPhase(
      TddPhase.Green,
      ["nonexistent.ts"],
      "Won't work",
      tmpDir
    );

    expect(result.committed).toBe(false);
    expect(result.message).toBe("No source files changed");
  });
});
