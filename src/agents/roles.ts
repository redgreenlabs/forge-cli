import { AgentRole } from "../config/schema.js";

/** Definition of an agent's capabilities and constraints */
export interface AgentDefinition {
  role: AgentRole;
  prompt: string;
  allowedTools: string[];
  qualityCriteria: string[];
}

const agentDefinitions: Record<AgentRole, AgentDefinition> = {
  [AgentRole.Architect]: {
    role: AgentRole.Architect,
    prompt: `You are the Architect agent. Your role is to design software architecture,
define data models, plan system boundaries, and make structural decisions.
Focus on:
- Clean architecture and separation of concerns
- Design patterns appropriate to the problem
- API contract design
- Data model and schema design
- Dependency management and module boundaries
- Scalability and maintainability considerations

Output architectural decisions as ADRs (Architecture Decision Records).
Do NOT implement code — only design and document structure.`,
    allowedTools: ["Read", "Glob", "Grep", "Edit"],
    qualityCriteria: [
      "Clear separation of concerns",
      "Documented design rationale",
      "Identified trade-offs",
    ],
  },

  [AgentRole.Implementer]: {
    role: AgentRole.Implementer,
    prompt: `You are the Implementer agent. Your role is to write production code that
fulfills the architectural design and passes existing tests.
Focus on:
- Clean, readable code with minimal complexity
- Following established patterns and conventions
- Type safety and null safety
- Error handling at system boundaries
- No premature abstractions — write the simplest thing that works
- Follow the existing test specifications exactly

Commit type: feat: or fix: depending on the change.`,
    allowedTools: [
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "Bash(npm run build)",
      "Bash(npm run typecheck)",
    ],
    qualityCriteria: [
      "All existing tests pass",
      "Code compiles without errors",
      "No TODO comments left behind",
    ],
  },

  [AgentRole.Tester]: {
    role: AgentRole.Tester,
    prompt: `You are the Tester agent. Your role is to write comprehensive tests
following TDD principles (Red-Green-Refactor).
Focus on:
- Write failing tests FIRST (Red phase)
- Cover happy paths, edge cases, and error paths
- Test behavior, not implementation details
- Meaningful test descriptions
- Use vitest/jest patterns: describe, it, expect
- Aim for high coverage without meaningless assertions
- Include integration tests for module boundaries

Commit type: test: for new tests.`,
    allowedTools: [
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "Bash(npm test)",
      "Bash(npm run test:coverage)",
      "Bash(npx vitest)",
    ],
    qualityCriteria: [
      "Tests cover edge cases",
      "Tests are deterministic",
      "Coverage thresholds met",
    ],
  },

  [AgentRole.Reviewer]: {
    role: AgentRole.Reviewer,
    prompt: `You are the Reviewer agent. Your role is to review code for quality,
correctness, and adherence to best practices. You do NOT write new code.
Focus on:
- Code correctness and logic errors
- Naming clarity and consistency
- Unnecessary complexity or over-engineering
- Missing error handling at boundaries
- Performance concerns
- Adherence to project conventions

Output a review report with findings categorized as: CRITICAL, WARNING, SUGGESTION.
Commit type: refactor: for improvements.`,
    allowedTools: ["Read", "Glob", "Grep"],
    qualityCriteria: [
      "Review covers all changed files",
      "Findings are actionable",
      "No false positives",
    ],
  },

  [AgentRole.Security]: {
    role: AgentRole.Security,
    prompt: `You are the Security Auditor agent. Your role is to identify and fix
security vulnerabilities in the codebase.
Focus on:
- OWASP Top 10 vulnerabilities (injection, XSS, CSRF, etc.)
- Input validation and sanitization
- Authentication and authorization flaws
- Secret exposure (API keys, tokens, passwords in code)
- Dependency vulnerabilities
- Insecure configurations
- Path traversal and file access issues
- Command injection in shell commands

Output a security report with severity levels: CRITICAL, HIGH, MEDIUM, LOW.
Commit type: security: for fixes.`,
    allowedTools: [
      "Read",
      "Edit",
      "Glob",
      "Grep",
      "Bash(npm audit)",
      "Bash(npx semgrep)",
    ],
    qualityCriteria: [
      "No critical vulnerabilities",
      "All inputs validated",
      "No hardcoded secrets",
    ],
  },

  [AgentRole.Documenter]: {
    role: AgentRole.Documenter,
    prompt: `You are the Documenter agent. Your role is to create and maintain
project documentation.
Focus on:
- API documentation with examples
- Architecture Decision Records (ADRs)
- README and getting started guides
- Inline code documentation (JSDoc/TSDoc) where non-obvious
- CHANGELOG maintenance
- Configuration documentation

Do NOT add documentation for self-evident code.
Commit type: docs: for documentation changes.`,
    allowedTools: [
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "Bash(npx typedoc)",
    ],
    qualityCriteria: [
      "Public APIs documented",
      "Examples are runnable",
      "No stale documentation",
    ],
  },
};

/** Get the system prompt for a specific agent role */
export function getAgentPrompt(role: AgentRole): string {
  return agentDefinitions[role].prompt;
}

/** Get the allowed tools for a specific agent role */
export function getAgentAllowedTools(role: AgentRole): string[] {
  return agentDefinitions[role].allowedTools;
}

/** Get the full agent definition for a role */
export function getAgentDefinition(role: AgentRole): AgentDefinition {
  return agentDefinitions[role];
}

/** Keyword patterns for task-to-agent matching */
const roleKeywords: Record<AgentRole, string[]> = {
  [AgentRole.Architect]: [
    "design",
    "architect",
    "schema",
    "structure",
    "plan",
    "model",
    "diagram",
    "boundary",
    "interface",
    "contract",
  ],
  [AgentRole.Implementer]: [
    "implement",
    "create",
    "build",
    "add",
    "develop",
    "code",
    "endpoint",
    "feature",
    "integrate",
  ],
  [AgentRole.Tester]: [
    "test",
    "spec",
    "coverage",
    "assert",
    "verify",
    "validate",
    "unit",
    "integration",
    "e2e",
  ],
  [AgentRole.Reviewer]: [
    "review",
    "audit",
    "inspect",
    "check",
    "quality",
    "refactor",
    "cleanup",
    "improve",
  ],
  [AgentRole.Security]: [
    "security",
    "vulnerab",
    "injection",
    "xss",
    "csrf",
    "auth",
    "encrypt",
    "secret",
    "owasp",
    "sanitiz",
  ],
  [AgentRole.Documenter]: [
    "document",
    "readme",
    "changelog",
    "api doc",
    "jsdoc",
    "typedoc",
    "adr",
    "guide",
    "wiki",
  ],
};

/**
 * Select the best agent role for a given task description.
 *
 * Matches task text against keyword patterns for each role.
 * Falls back to Implementer if no match, or first available role
 * if Implementer is not in the team.
 */
export function selectAgentForTask(
  taskDescription: string,
  availableRoles: AgentRole[]
): AgentRole {
  const lower = taskDescription.toLowerCase();

  let bestRole: AgentRole | null = null;
  let bestScore = 0;

  for (const role of availableRoles) {
    const keywords = roleKeywords[role];
    const score = keywords.filter((kw) => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestRole = role;
    }
  }

  if (bestRole) return bestRole;

  // Fallback: prefer implementer, then first available
  if (availableRoles.includes(AgentRole.Implementer)) {
    return AgentRole.Implementer;
  }
  return availableRoles[0] ?? AgentRole.Implementer;
}
