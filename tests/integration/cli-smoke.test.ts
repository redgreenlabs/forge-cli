import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const PROJECT_ROOT = join(__dirname, "../..");
const CLI_PATH = join(PROJECT_ROOT, "dist/cli.js");

// These tests spawn child processes — skip unless CI or explicitly requested
const RUN_SMOKE = process.env.CI === "true" || process.env.SMOKE === "1";
const describeSmoke = RUN_SMOKE ? describe : describe.skip;

function runCli(
  args: string,
  cwd: string
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30_000,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.status ?? 1,
    };
  }
}

describeSmoke("CLI Smoke Tests", () => {
  let tmpDir: string;

  beforeAll(() => {
    // Ensure the built CLI exists (CI runs build before integration tests)
    if (!existsSync(CLI_PATH)) {
      execSync("npm run build", { cwd: PROJECT_ROOT, stdio: "pipe" });
    }
  });

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
    const { stdout, exitCode, stderr } = runCli("init --name test-proj --no-scan", tmpDir);
    expect(exitCode, `init failed: ${stderr}`).toBe(0);
    expect(stdout).toContain("initialized");
  });

  it("should fail init on duplicate", () => {
    runCli("init --name first --no-scan", tmpDir);
    const { exitCode } = runCli("init --name second --no-scan", tmpDir);
    expect(exitCode).toBe(1);
  });

  it("should import a PRD after init", () => {
    runCli("init --name test --no-scan", tmpDir);
    const prdPath = join(tmpDir, "prd.md");
    writeFileSync(
      prdPath,
      "# Test PRD\n- [ ] Task one [HIGH]\n- [ ] Task two\n"
    );

    const { stdout, exitCode, stderr } = runCli(`import --no-scan ${prdPath}`, tmpDir);
    expect(exitCode, `import failed: ${stderr}`).toBe(0);
    expect(stdout).toContain("Imported");
  });

  it("should show status without active session", () => {
    runCli("init --name test --no-scan", tmpDir);
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
    runCli("init --name test --no-scan", tmpDir);
    const { stdout, exitCode } = runCli("run --dry-run", tmpDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("DRY RUN");
  });
});
