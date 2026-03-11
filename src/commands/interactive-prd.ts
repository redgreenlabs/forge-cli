/** Project template types */
export enum PrdTemplate {
  WebApp = "web-app",
  CliTool = "cli-tool",
  Library = "library",
  Api = "api",
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
