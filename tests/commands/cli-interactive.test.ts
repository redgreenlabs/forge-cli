import { describe, it, expect } from "vitest";
import {
  generatePrdFromAnswers,
  PrdTemplate,
  getTemplateDefaults,
  type InteractivePrdAnswers,
} from "../../src/commands/interactive-prd.js";

describe("CLI Interactive PRD", () => {
  describe("template defaults", () => {
    it("should provide defaults for web-app template", () => {
      const defaults = getTemplateDefaults(PrdTemplate.WebApp);
      expect(defaults.features.length).toBeGreaterThan(0);
      expect(defaults.stack).toContain("React");
    });

    it("should provide defaults for cli-tool template", () => {
      const defaults = getTemplateDefaults(PrdTemplate.CliTool);
      expect(defaults.features.length).toBeGreaterThan(0);
      expect(defaults.stack).toContain("Node.js");
    });

    it("should provide defaults for library template", () => {
      const defaults = getTemplateDefaults(PrdTemplate.Library);
      expect(defaults.features.length).toBeGreaterThan(0);
    });

    it("should provide defaults for api template", () => {
      const defaults = getTemplateDefaults(PrdTemplate.Api);
      expect(defaults.features.length).toBeGreaterThan(0);
      expect(defaults.stack).toContain("REST");
    });
  });

  describe("full PRD generation flow", () => {
    it("should generate a complete PRD from template defaults", () => {
      const defaults = getTemplateDefaults(PrdTemplate.WebApp);
      const answers: InteractivePrdAnswers = {
        projectName: "my-web-app",
        vision: "A modern web application",
        ...defaults,
      };
      const prd = generatePrdFromAnswers(answers);
      expect(prd).toContain("# my-web-app");
      expect(prd).toContain("US-1:");
    });

    it("should merge custom features with template", () => {
      const defaults = getTemplateDefaults(PrdTemplate.Api);
      const answers: InteractivePrdAnswers = {
        projectName: "custom-api",
        vision: "Custom API",
        ...defaults,
        features: [...defaults.features, "WebSocket support"],
      };
      const prd = generatePrdFromAnswers(answers);
      expect(prd).toContain("WebSocket support");
    });
  });
});
