/** Project template types */
export enum PrdTemplate {
  WebApp = "web-app",
  CliTool = "cli-tool",
  Library = "library",
  Api = "api",
}

/** Template default values (stack, features, constraints, non-functional) */
interface TemplateDefaults {
  stack: string;
  features: string[];
  constraints: string[];
  nonFunctional: string[];
}

const TEMPLATE_DEFAULTS: Record<PrdTemplate, TemplateDefaults> = {
  [PrdTemplate.WebApp]: {
    stack: "React, TypeScript, Vite, Tailwind CSS",
    features: [
      "User authentication and authorization",
      "Responsive dashboard layout",
      "Data management with CRUD operations",
      "Search and filtering",
    ],
    constraints: ["Must support modern browsers (Chrome, Firefox, Safari, Edge)"],
    nonFunctional: ["Page load time < 3s", "Lighthouse score > 90"],
  },
  [PrdTemplate.CliTool]: {
    stack: "Node.js, TypeScript, Commander.js",
    features: [
      "Command-line argument parsing",
      "Configuration file support",
      "Interactive prompts",
      "Colored output and progress indicators",
    ],
    constraints: ["Must run on Node.js 18+"],
    nonFunctional: ["Startup time < 500ms", "Zero runtime errors"],
  },
  [PrdTemplate.Library]: {
    stack: "TypeScript, tsup, Vitest",
    features: [
      "Core API with TypeScript types",
      "Comprehensive test suite",
      "API documentation",
      "Tree-shakeable ESM exports",
    ],
    constraints: ["Must support ESM and CJS"],
    nonFunctional: ["100% API documentation", "90%+ test coverage"],
  },
  [PrdTemplate.Api]: {
    stack: "Node.js, TypeScript, Express/Fastify, REST API",
    features: [
      "RESTful endpoint design",
      "Authentication and authorization",
      "Input validation and error handling",
      "Database integration",
      "API documentation (OpenAPI/Swagger)",
    ],
    constraints: ["Must follow REST conventions"],
    nonFunctional: ["Response time < 200ms", "99.9% uptime"],
  },
};

/** Get default values for a project template */
export function getTemplateDefaults(template: PrdTemplate): TemplateDefaults {
  return { ...TEMPLATE_DEFAULTS[template] };
}

/** Answers collected from the interactive PRD creation flow */
export interface InteractivePrdAnswers {
  projectName: string;
  vision: string;
  stack: string;
  features: string[];
  constraints: string[];
  nonFunctional: string[];
}

/**
 * Generate a Markdown PRD from interactive answers.
 *
 * Creates a structured PRD with:
 * - Vision statement
 * - Technology stack
 * - User stories (numbered US-1, US-2, ...)
 * - Constraints and non-functional requirements (when provided)
 */
export function generatePrdFromAnswers(answers: InteractivePrdAnswers): string {
  const lines: string[] = [];

  // Title
  lines.push(`# ${answers.projectName}`);
  lines.push("");

  // Vision
  lines.push("## Vision");
  lines.push("");
  lines.push(answers.vision);
  lines.push("");

  // Tech Stack
  lines.push("## Technology Stack");
  lines.push("");
  lines.push(answers.stack);
  lines.push("");

  // User Stories
  lines.push("## User Stories");
  lines.push("");
  for (let i = 0; i < answers.features.length; i++) {
    const feature = answers.features[i]!;
    lines.push(`### US-${i + 1}: ${feature}`);
    lines.push("");
    lines.push(`As a user, I want ${feature.toLowerCase()} so that the project delivers value.`);
    lines.push("");
    lines.push("**Acceptance Criteria:**");
    lines.push(`- [ ] ${feature} is implemented and working`);
    lines.push(`- [ ] Tests cover the feature with >80% coverage`);
    lines.push(`- [ ] Documentation is updated`);
    lines.push("");
  }

  // Constraints
  if (answers.constraints.length > 0) {
    lines.push("## Constraints");
    lines.push("");
    for (const constraint of answers.constraints) {
      lines.push(`- ${constraint}`);
    }
    lines.push("");
  }

  // Non-Functional Requirements
  if (answers.nonFunctional.length > 0) {
    lines.push("## Non-Functional Requirements");
    lines.push("");
    for (const nfr of answers.nonFunctional) {
      lines.push(`- ${nfr}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
