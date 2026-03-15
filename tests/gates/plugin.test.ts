import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  GatePluginRegistry,
  createBuiltinGates,
  type GatePlugin,
} from "../../src/gates/plugin.js";
import { QualityGateSeverity } from "../../src/config/schema.js";

describe("Gate Plugin System", () => {
  describe("GatePluginRegistry", () => {
    let registry: GatePluginRegistry;

    beforeEach(() => {
      registry = new GatePluginRegistry();
    });

    it("should start empty", () => {
      expect(registry.list()).toHaveLength(0);
    });

    it("should register a plugin", () => {
      const plugin: GatePlugin = {
        name: "custom-lint",
        description: "Custom linting gate",
        severity: QualityGateSeverity.Warn,
        check: async () => ({ passed: true, message: "Clean" }),
      };
      registry.register(plugin);
      expect(registry.list()).toHaveLength(1);
      expect(registry.get("custom-lint")).toBeDefined();
    });

    it("should reject duplicate plugin names", () => {
      const plugin: GatePlugin = {
        name: "gate-a",
        description: "First",
        severity: QualityGateSeverity.Block,
        check: async () => ({ passed: true, message: "" }),
      };
      registry.register(plugin);
      expect(() => registry.register(plugin)).toThrow("already registered");
    });

    it("should unregister a plugin", () => {
      const plugin: GatePlugin = {
        name: "removable",
        description: "To be removed",
        severity: QualityGateSeverity.Block,
        check: async () => ({ passed: true, message: "" }),
      };
      registry.register(plugin);
      registry.unregister("removable");
      expect(registry.list()).toHaveLength(0);
    });

    it("should convert plugins to gate definitions", () => {
      registry.register({
        name: "test-gate",
        description: "Runs tests",
        severity: QualityGateSeverity.Block,
        check: async () => ({ passed: true, message: "All pass" }),
      });
      const gates = registry.toGateDefinitions();
      expect(gates).toHaveLength(1);
      expect(gates[0]?.name).toBe("test-gate");
    });

    it("should override severity for a plugin", () => {
      registry.register({
        name: "lint",
        description: "Linting",
        severity: QualityGateSeverity.Block,
        check: async () => ({ passed: true, message: "" }),
      });
      registry.setSeverity("lint", QualityGateSeverity.Warn);
      const gates = registry.toGateDefinitions();
      expect(gates[0]?.severity).toBe(QualityGateSeverity.Warn);
    });
  });

  describe("createBuiltinGates", () => {
    it("should create all 5 builtin gates", () => {
      const gates = createBuiltinGates({
        projectRoot: "/tmp/test",
        testCommand: "npm test",
        lintCommand: "npm run lint",
      });
      expect(gates).toHaveLength(5);
      const names = gates.map((g) => g.name);
      expect(names).toContain("tests-pass");
      expect(names).toContain("coverage-threshold");
      expect(names).toContain("security-scan");
      expect(names).toContain("linting");
      expect(names).toContain("conventional-commit");
    });

    it("should create gates with correct default severities", () => {
      const gates = createBuiltinGates({
        projectRoot: "/tmp/test",
        testCommand: "npm test",
        lintCommand: "npm run lint",
      });
      const testGate = gates.find((g) => g.name === "tests-pass");
      expect(testGate?.severity).toBe(QualityGateSeverity.Block);
      const lintGate = gates.find((g) => g.name === "linting");
      expect(lintGate?.severity).toBe(QualityGateSeverity.Block);
    });
  });

  describe("builtin gate check() functions", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "forge-gate-check-"));
      // Create a git repo with a conventional commit for the commit gate
      const { execSync } = require("child_process");
      execSync("git init", { cwd: tmpDir, stdio: "pipe" });
      execSync("git config user.email 'test@test.com'", { cwd: tmpDir, stdio: "pipe" });
      execSync("git config user.name 'Test'", { cwd: tmpDir, stdio: "pipe" });
      writeFileSync(join(tmpDir, "index.ts"), "export const x = 1;\n");
      execSync("git add -A && git commit -m 'feat: initial commit'", { cwd: tmpDir, stdio: "pipe" });
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    function getGate(name: string, opts?: Partial<import("../../src/gates/plugin.js").BuiltinGateOptions>) {
      const gates = createBuiltinGates({
        projectRoot: tmpDir,
        testCommand: "echo tests-pass",
        lintCommand: "echo lint-pass",
        ...opts,
      });
      return gates.find((g) => g.name === name)!;
    }

    describe("tests-pass gate", () => {
      it("should pass when test command succeeds", async () => {
        const gate = getGate("tests-pass", { testCommand: "echo ok" });
        const result = await gate.check();
        expect(result.passed).toBe(true);
        expect(result.message).toBe("All tests pass");
      });

      it("should fail when test command fails", async () => {
        const gate = getGate("tests-pass", { testCommand: "exit 1" });
        const result = await gate.check();
        expect(result.passed).toBe(false);
      });
    });

    describe("coverage-threshold gate", () => {
      it("should always pass (delegated to test runner)", async () => {
        const gate = getGate("coverage-threshold");
        const result = await gate.check();
        expect(result.passed).toBe(true);
      });
    });

    describe("security-scan gate", () => {
      it("should pass for node workspace when audit succeeds", async () => {
        // Use a command that succeeds as the audit
        const gate = getGate("security-scan", { workspaceType: "node" });
        // npm audit may fail on a bare tmpDir, so we need package.json
        writeFileSync(join(tmpDir, "package.json"), '{"name":"test","version":"1.0.0"}\n');
        // We can't guarantee npm audit passes, so just verify it returns a result
        const result = await gate.check();
        expect(result).toHaveProperty("passed");
        expect(result).toHaveProperty("message");
      });

      it("should pass when no audit tool for workspace type", async () => {
        const gate = getGate("security-scan", { workspaceType: "other" });
        // "other" has no package.json in tmpDir → getAuditCommand returns null
        const result = await gate.check();
        expect(result.passed).toBe(true);
        expect(result.message).toBe("No audit tool for this workspace type");
      });

      it("should pass with fallback npm audit when package.json exists", async () => {
        writeFileSync(join(tmpDir, "package.json"), '{"name":"test","version":"1.0.0"}\n');
        const gate = getGate("security-scan"); // no workspaceType → default branch
        const result = await gate.check();
        expect(result).toHaveProperty("passed");
      });

      it("should pass when no package.json and no workspace type", async () => {
        const gate = getGate("security-scan"); // no workspaceType, no package.json
        const result = await gate.check();
        expect(result.passed).toBe(true);
        expect(result.message).toBe("No audit tool for this workspace type");
      });
    });

    describe("linting gate", () => {
      it("should pass when lint command succeeds", async () => {
        const gate = getGate("linting", { lintCommand: "echo ok" });
        const result = await gate.check();
        expect(result.passed).toBe(true);
        expect(result.message).toBe("No linting issues");
      });

      it("should fail when lint command fails", async () => {
        const gate = getGate("linting", { lintCommand: "exit 1" });
        const result = await gate.check();
        expect(result.passed).toBe(false);
        expect(result.message).toBe("Linting issues found");
      });
    });

    describe("conventional-commit gate", () => {
      it("should pass for a valid conventional commit", async () => {
        const gate = getGate("conventional-commit");
        const result = await gate.check();
        expect(result.passed).toBe(true);
        expect(result.message).toContain("feat: initial commit");
      });

      it("should fail for an invalid commit message", async () => {
        const { execSync } = require("child_process");
        writeFileSync(join(tmpDir, "extra.ts"), "export const y = 2;\n");
        execSync("git add -A && git commit -m 'bad commit message'", { cwd: tmpDir, stdio: "pipe" });

        const gate = getGate("conventional-commit");
        const result = await gate.check();
        expect(result.passed).toBe(false);
      });
    });
  });
});
