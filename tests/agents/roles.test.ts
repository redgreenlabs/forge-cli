import { describe, it, expect } from "vitest";
import {
  getAgentPrompt,
  getAgentAllowedTools,
  selectAgentForTask,
  type AgentDefinition,
} from "../../src/agents/roles.js";
import { AgentRole } from "../../src/config/schema.js";

describe("Agent Roles", () => {
  describe("getAgentPrompt", () => {
    it("should return a non-empty prompt for each role", () => {
      for (const role of Object.values(AgentRole)) {
        const prompt = getAgentPrompt(role);
        expect(prompt.length).toBeGreaterThan(50);
      }
    });

    it("should include TDD instructions for tester role", () => {
      const prompt = getAgentPrompt(AgentRole.Tester);
      expect(prompt.toLowerCase()).toContain("test");
    });

    it("should include security focus for security role", () => {
      const prompt = getAgentPrompt(AgentRole.Security);
      expect(prompt.toLowerCase()).toContain("security");
      expect(prompt.toLowerCase()).toContain("vulnerab");
    });

    it("should include architecture guidance for architect role", () => {
      const prompt = getAgentPrompt(AgentRole.Architect);
      expect(prompt.toLowerCase()).toContain("architect");
    });

    it("should include documentation focus for documenter role", () => {
      const prompt = getAgentPrompt(AgentRole.Documenter);
      expect(prompt.toLowerCase()).toContain("document");
    });
  });

  describe("getAgentAllowedTools", () => {
    it("should allow Read for all agents", () => {
      for (const role of Object.values(AgentRole)) {
        const tools = getAgentAllowedTools(role);
        expect(tools).toContain("Read");
      }
    });

    it("should allow Write for implementer", () => {
      const tools = getAgentAllowedTools(AgentRole.Implementer);
      expect(tools).toContain("Write");
      expect(tools).toContain("Edit");
    });

    it("should restrict destructive tools for reviewer", () => {
      const tools = getAgentAllowedTools(AgentRole.Reviewer);
      expect(tools).not.toContain("Write");
    });

    it("should include base tools without project commands", () => {
      const tools = getAgentAllowedTools(AgentRole.Tester);
      expect(tools).toContain("Read");
      expect(tools).toContain("Write");
      expect(tools).not.toContain("Bash(npm test)");
    });

    it("should add Node test command for tester with Node project", () => {
      const tools = getAgentAllowedTools(AgentRole.Tester, {
        test: "npm test", lint: "npm run lint", build: "npm run build", typecheck: "npx tsc --noEmit",
      });
      expect(tools).toContain("Bash(npm test)");
    });

    it("should add Rust test command for tester with Rust project", () => {
      const tools = getAgentAllowedTools(AgentRole.Tester, {
        test: "cargo test", lint: "cargo clippy", build: "cargo build", typecheck: "cargo check",
      });
      expect(tools).toContain("Bash(cargo test)");
      expect(tools).not.toContain("Bash(npm test)");
    });

    it("should add Python test command for tester with Python project", () => {
      const tools = getAgentAllowedTools(AgentRole.Tester, {
        test: "pytest", lint: "ruff check", build: "python -m build", typecheck: "mypy .",
      });
      expect(tools).toContain("Bash(pytest)");
    });

    it("should add Go test command for tester with Go project", () => {
      const tools = getAgentAllowedTools(AgentRole.Tester, {
        test: "go test ./...", lint: "go vet ./...", build: "go build ./...", typecheck: "",
      });
      expect(tools).toContain("Bash(go test ./...)");
    });

    it("should add build and typecheck for implementer", () => {
      const tools = getAgentAllowedTools(AgentRole.Implementer, {
        test: "cargo test", lint: "cargo clippy", build: "cargo build", typecheck: "cargo check",
      });
      expect(tools).toContain("Bash(cargo build)");
      expect(tools).toContain("Bash(cargo check)");
    });

    it("should add npm audit for security agent on Node projects", () => {
      const tools = getAgentAllowedTools(AgentRole.Security, {
        test: "npm test", lint: "npm run lint", build: "npm run build", typecheck: "",
      });
      expect(tools).toContain("Bash(npm audit)");
    });

    it("should add cargo audit for security agent on Rust projects", () => {
      const tools = getAgentAllowedTools(AgentRole.Security, {
        test: "cargo test", lint: "cargo clippy", build: "cargo build", typecheck: "",
      });
      expect(tools).toContain("Bash(cargo audit)");
    });

    it("should add pip-audit for security agent on Python projects", () => {
      const tools = getAgentAllowedTools(AgentRole.Security, {
        test: "pytest", lint: "ruff check", build: "python -m build", typecheck: "",
      });
      expect(tools).toContain("Bash(pip-audit)");
    });

    it("should not add empty typecheck command as tool", () => {
      const tools = getAgentAllowedTools(AgentRole.Implementer, {
        test: "pytest", lint: "ruff check", build: "python -m build", typecheck: "",
      });
      expect(tools).not.toContain("Bash()");
    });
  });

  describe("selectAgentForTask", () => {
    const allRoles = Object.values(AgentRole);

    it("should select architect for design tasks", () => {
      const role = selectAgentForTask("Design the database schema", allRoles);
      expect(role).toBe(AgentRole.Architect);
    });

    it("should select implementer for coding tasks", () => {
      const role = selectAgentForTask(
        "Implement the login endpoint",
        allRoles
      );
      expect(role).toBe(AgentRole.Implementer);
    });

    it("should select tester for test tasks", () => {
      const role = selectAgentForTask("Write unit tests for auth", allRoles);
      expect(role).toBe(AgentRole.Tester);
    });

    it("should select security for vulnerability tasks", () => {
      const role = selectAgentForTask(
        "Fix SQL injection vulnerability",
        allRoles
      );
      expect(role).toBe(AgentRole.Security);
    });

    it("should select documenter for documentation tasks", () => {
      const role = selectAgentForTask("Write API documentation", allRoles);
      expect(role).toBe(AgentRole.Documenter);
    });

    it("should fall back to implementer if role not in team", () => {
      const role = selectAgentForTask("Design the schema", [
        AgentRole.Implementer,
        AgentRole.Tester,
      ]);
      expect(role).toBe(AgentRole.Implementer);
    });

    it("should return first available role if no keyword match", () => {
      const role = selectAgentForTask("Do something generic", [
        AgentRole.Tester,
      ]);
      expect(role).toBe(AgentRole.Tester);
    });
  });
});
