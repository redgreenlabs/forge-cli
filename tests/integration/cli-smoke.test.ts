import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const CLI_PATH = join(__dirname, "../../src/cli.ts");
const TSX = "npx tsx";

function runCli(args: string, cwd: string): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(`${TSX} ${CLI_PATH} ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15_000,
    });
    return { stdout, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; status?: number };
    return { stdout: e.stdout ?? "", exitCode: e.status ?? 1 };
  }
}

describe("CLI Smoke Tests", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-cli-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should show version", () => {
    const { stdout, exitCode } = runCli("--version", tmpDir);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("should show help", () => {
    const { stdout, exitCode } = runCli("--help", tmpDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("forge");
    expect(stdout).toContain("init");
    expect(stdout).toContain("run");
    expect(stdout).toContain("import");
  });

  it("should init a project", () => {
    const { stdout, exitCode } = runCli("init --name test-proj", tmpDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("initialized");
  });

  it("should fail init on duplicate", () => {
    runCli("init --name first", tmpDir);
    const { exitCode } = runCli("init --name second", tmpDir);
    expect(exitCode).toBe(1);
  });

  it("should import a PRD after init", () => {
    runCli("init --name test", tmpDir);
    const prdPath = join(tmpDir, "prd.md");
    writeFileSync(prdPath, "# Test PRD\n- [ ] Task one [HIGH]\n- [ ] Task two\n");

    const { stdout, exitCode } = runCli(`import ${prdPath}`, tmpDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Imported");
  });

  it("should show status without active session", () => {
    runCli("init --name test", tmpDir);
    const { stdout, exitCode } = runCli("status", tmpDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("No active");
  });

  it("should list agents", () => {
    const { stdout, exitCode } = runCli("agents", tmpDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("architect");
    expect(stdout).toContain("implementer");
    expect(stdout).toContain("tester");
  });

  it("should show dry-run dashboard", () => {
    runCli("init --name test", tmpDir);
    const { stdout, exitCode } = runCli("run --dry-run", tmpDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("DRY RUN");
  });
});
