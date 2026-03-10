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
      expect(lintGate?.severity).toBe(QualityGateSeverity.Warn);
    });
  });
});
