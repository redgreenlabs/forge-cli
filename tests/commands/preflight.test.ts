import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runPreflightChecks, type PreflightResult } from "../../src/commands/preflight.js";
import { defaultConfig, type ForgeConfig } from "../../src/config/schema.js";

describe("preflight checks", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-preflight-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should pass when git and claude are available with default config", () => {
    // Default config uses npm test — create a package.json so project file check passes
    writeFileSync(join(tmpDir, "package.json"), "{}");

    const result = runPreflightChecks(defaultConfig, tmpDir);

    // git and node/npm should be available in test environment
    const gitCheck = result.checks.find((c) => c.name === "git");
    expect(gitCheck?.ok).toBe(true);
  });

  it("should fail when test command tool is not available", () => {
    const config: ForgeConfig = {
      ...defaultConfig,
      commands: {
        ...defaultConfig.commands,
        test: "nonexistent-tool test",
      },
    };

    const result = runPreflightChecks(config, tmpDir);
    const testCheck = result.checks.find((c) => c.name === "test");
    expect(testCheck?.ok).toBe(false);
    expect(testCheck?.message).toContain("nonexistent-tool");
    expect(testCheck?.fix).toBeDefined();
  });

  it("should fail when lint command tool is not available", () => {
    writeFileSync(join(tmpDir, "package.json"), "{}");
    const config: ForgeConfig = {
      ...defaultConfig,
      commands: {
        ...defaultConfig.commands,
        lint: "fakeLinter check",
      },
    };

    const result = runPreflightChecks(config, tmpDir);
    const lintCheck = result.checks.find((c) => c.name === "lint");
    expect(lintCheck?.ok).toBe(false);
    expect(lintCheck?.message).toContain("fakeLinter");
  });

  it("should check for package.json when using npm commands", () => {
    // No package.json in tmpDir
    const result = runPreflightChecks(defaultConfig, tmpDir);
    const pkgCheck = result.checks.find((c) => c.name === "package.json");
    expect(pkgCheck?.ok).toBe(false);
    expect(pkgCheck?.fix).toContain("npm init");
  });

  it("should pass package.json check when file exists", () => {
    writeFileSync(join(tmpDir, "package.json"), "{}");
    const result = runPreflightChecks(defaultConfig, tmpDir);
    const pkgCheck = result.checks.find((c) => c.name === "package.json");
    expect(pkgCheck).toBeUndefined(); // no check added when file exists
  });

  it("should check for pubspec.yaml when using flutter commands", () => {
    const config: ForgeConfig = {
      ...defaultConfig,
      commands: {
        test: "flutter test",
        lint: "dart analyze",
        build: "flutter build",
        typecheck: "dart analyze",
      },
    };

    const result = runPreflightChecks(config, tmpDir);
    const pubspecCheck = result.checks.find((c) => c.name === "pubspec.yaml");
    expect(pubspecCheck?.ok).toBe(false);
    expect(pubspecCheck?.fix).toContain("flutter create");
  });

  it("should check for Cargo.toml when using cargo commands", () => {
    const config: ForgeConfig = {
      ...defaultConfig,
      commands: {
        test: "cargo test",
        lint: "cargo clippy",
        build: "cargo build",
        typecheck: "cargo check",
      },
    };

    const result = runPreflightChecks(config, tmpDir);
    const cargoCheck = result.checks.find((c) => c.name === "Cargo.toml");
    expect(cargoCheck?.ok).toBe(false);
    expect(cargoCheck?.fix).toContain("cargo init");
  });

  it("should check for go.mod when using go test", () => {
    const config: ForgeConfig = {
      ...defaultConfig,
      commands: {
        test: "go test ./...",
        lint: "go vet ./...",
        build: "go build ./...",
        typecheck: "",
      },
    };

    const result = runPreflightChecks(config, tmpDir);
    const goModCheck = result.checks.find((c) => c.name === "go.mod");
    expect(goModCheck?.ok).toBe(false);
    expect(goModCheck?.fix).toContain("go mod init");
  });

  it("should include install hints in fix messages", () => {
    const config: ForgeConfig = {
      ...defaultConfig,
      commands: {
        ...defaultConfig.commands,
        test: "flutter test",
      },
    };

    const result = runPreflightChecks(config, tmpDir);
    const testCheck = result.checks.find((c) => c.name === "test");
    // flutter may or may not be installed — check the fix message structure
    if (!testCheck?.ok) {
      expect(testCheck?.fix).toContain("flutter");
      expect(testCheck?.fix).toContain("forge.config.json");
    }
  });

  it("should report overall passed=false when any check fails", () => {
    const config: ForgeConfig = {
      ...defaultConfig,
      commands: {
        ...defaultConfig.commands,
        test: "totallyFakeCommand test",
      },
    };

    const result = runPreflightChecks(config, tmpDir);
    expect(result.passed).toBe(false);
  });

  it("should skip typecheck check when not configured", () => {
    writeFileSync(join(tmpDir, "package.json"), "{}");
    const config: ForgeConfig = {
      ...defaultConfig,
      commands: {
        ...defaultConfig.commands,
        typecheck: "",
      },
    };

    const result = runPreflightChecks(config, tmpDir);
    const typecheckCheck = result.checks.find((c) => c.name === "typecheck");
    // Empty typecheck command means no check is added at all
    expect(typecheckCheck).toBeUndefined();
  });
});
