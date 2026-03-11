import { describe, it, expect } from "vitest";
import {
  generatePrdFromAnswers,
  PrdTemplate,
  type InteractivePrdAnswers,
} from "../../src/commands/interactive-prd.js";

describe("Interactive PRD Generation", () => {
  describe("generatePrdFromAnswers", () => {
    const baseAnswers: InteractivePrdAnswers = {
      projectName: "my-api",
      vision: "A REST API for managing tasks with authentication",
      stack: "Node.js, Express, PostgreSQL",
      features: [
        "User authentication with JWT",
        "CRUD operations for tasks",
        "Role-based access control",
      ],
      constraints: ["Must support PostgreSQL 14+", "Response time < 200ms"],
      nonFunctional: ["99.9% uptime", "Horizontal scalability"],
    };

    it("should generate valid Markdown PRD", () => {
      const prd = generatePrdFromAnswers(baseAnswers);
      expect(prd).toContain("# my-api");
      expect(prd).toContain("## Vision");
      expect(prd).toContain("REST API for managing tasks");
    });

    it("should include all features as user stories", () => {
      const prd = generatePrdFromAnswers(baseAnswers);
      expect(prd).toContain("User authentication with JWT");
      expect(prd).toContain("CRUD operations for tasks");
      expect(prd).toContain("Role-based access control");
    });

    it("should include tech stack section", () => {
      const prd = generatePrdFromAnswers(baseAnswers);
      expect(prd).toContain("## Technology Stack");
      expect(prd).toContain("Node.js, Express, PostgreSQL");
    });

    it("should include constraints", () => {
      const prd = generatePrdFromAnswers(baseAnswers);
      expect(prd).toContain("## Constraints");
      expect(prd).toContain("PostgreSQL 14+");
    });

    it("should include non-functional requirements", () => {
      const prd = generatePrdFromAnswers(baseAnswers);
      expect(prd).toContain("## Non-Functional Requirements");
      expect(prd).toContain("99.9% uptime");
    });

    it("should number features as user stories", () => {
      const prd = generatePrdFromAnswers(baseAnswers);
      expect(prd).toContain("US-1:");
      expect(prd).toContain("US-2:");
      expect(prd).toContain("US-3:");
    });

    it("should handle empty optional fields", () => {
      const minimal: InteractivePrdAnswers = {
        projectName: "minimal",
        vision: "A minimal project",
        stack: "Python",
        features: ["One feature"],
        constraints: [],
        nonFunctional: [],
      };
      const prd = generatePrdFromAnswers(minimal);
      expect(prd).toContain("# minimal");
      expect(prd).not.toContain("## Constraints");
      expect(prd).not.toContain("## Non-Functional");
    });
  });

  describe("PrdTemplate", () => {
    it("should have a web-app template", () => {
      const template = PrdTemplate.WebApp;
      expect(template).toBeDefined();
    });

    it("should have a cli-tool template", () => {
      const template = PrdTemplate.CliTool;
      expect(template).toBeDefined();
    });

    it("should have a library template", () => {
      const template = PrdTemplate.Library;
      expect(template).toBeDefined();
    });

    it("should have an api template", () => {
      const template = PrdTemplate.Api;
      expect(template).toBeDefined();
    });
  });
});
