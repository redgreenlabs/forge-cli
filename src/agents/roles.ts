import { AgentRole } from "../config/schema.js";

/** Project commands used to derive agent tool permissions */
export interface AgentProjectCommands {
  test: string;
  lint: string;
  build: string;
  typecheck: string;
}

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
    ],
    qualityCriteria: [
      "All existing tests pass",
      "Code compiles without errors",
      "No TODO comments left behind",
    ],
  },

  [AgentRole.Tester]: {
    role: AgentRole.Tester,
    prompt: `You are the Tester agent. Your role is to write focused, useful tests
following TDD principles (Red-Green-Refactor).

SCOPE RULES — only test what the task asks for:
- Write tests that verify the task's acceptance criteria and nothing else
- Test the functional behavior described in the task (inputs → outputs, user interactions, state changes)
- Do NOT write meta-tests (project structure, file existence, readme content, license checks, config validation)
- Do NOT write tests for things the task doesn't mention
- Do NOT test build systems, CI pipelines, or deployment config unless the task explicitly requires it
- Each test should fail for a meaningful reason that the Green phase must fix with real code

Focus on:
- Write failing tests FIRST (Red phase)
- Test behavior, not implementation details
- Meaningful test descriptions
- Follow the project's existing test patterns and framework
- Keep tests minimal — one test file per task, not multiple files

Commit type: test: for new tests.`,
    allowedTools: [
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
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
- Inline code documentation where non-obvious
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

/**
 * Build a unified TDD system prompt that covers all phases.
 *
 * Combines tester + implementer instructions into a single prompt so the
 * system prompt stays constant across `--continue` calls, allowing Claude
 * to keep full context (read files, test results) from previous phases.
 */
export function getTddSystemPrompt(): string {
  return `You are a TDD-driven developer. You work in strict Red-Green-Refactor phases.
Your prompt will tell you which phase you are in — follow it precisely.

## RED PHASE (Tester role)
${agentDefinitions[AgentRole.Tester].prompt}

## GREEN PHASE (Implementer role)
${agentDefinitions[AgentRole.Implementer].prompt}

## REFACTOR PHASE (Implementer role)
Improve code quality, reduce duplication, and clean up without changing behavior.
All tests MUST still pass after refactoring.

## FIX PHASE (Implementer role)
When quality gates fail, fix the underlying code issues. Run the failing commands
to verify your fixes. Do NOT skip or disable checks.`;
}

/**
 * Get the allowed tools for a specific agent role.
 *
 * When project commands are provided, Bash tool permissions are derived
 * from the actual test/lint/build/typecheck commands configured for the
 * project (e.g. `cargo test` for Rust, `pytest` for Python) instead of
 * being hardcoded to npm.
 */
export function getAgentAllowedTools(
  role: AgentRole,
  commands?: AgentProjectCommands
): string[] {
  const base = [...agentDefinitions[role].allowedTools];

  if (!commands) return base;

  const bashTool = (cmd: string) => `Bash(${cmd})`;

  switch (role) {
    case AgentRole.Implementer:
      if (commands.build) base.push(bashTool(commands.build));
      if (commands.typecheck) base.push(bashTool(commands.typecheck));
      break;

    case AgentRole.Tester:
      if (commands.test) base.push(bashTool(commands.test));
      break;

    case AgentRole.Security:
      // Derive audit command from project type
      if (commands.test.startsWith("npm") || commands.test.startsWith("npx")) {
        base.push(bashTool("npm audit"));
      } else if (commands.test.startsWith("cargo")) {
        base.push(bashTool("cargo audit"));
      } else if (commands.test.startsWith("pytest") || commands.test.startsWith("python")) {
        base.push(bashTool("pip-audit"));
      }
      break;

    case AgentRole.Documenter:
      // Docs tools vary by ecosystem
      if (commands.test.startsWith("npm") || commands.test.startsWith("npx")) {
        base.push(bashTool("npx typedoc"));
      } else if (commands.test.startsWith("cargo")) {
        base.push(bashTool("cargo doc"));
      } else if (commands.test.startsWith("go ")) {
        base.push(bashTool("go doc"));
      }
      break;

    default:
      break;
  }

  return base;
}

/**
 * Get the union of allowed tools for TDD phases (tester + implementer).
 *
 * Used alongside getTddSystemPrompt() so that tool permissions stay
 * constant across `--continue` calls.
 */
export function getTddAllowedTools(commands?: AgentProjectCommands): string[] {
  const testerTools = getAgentAllowedTools(AgentRole.Tester, commands);
  const implTools = getAgentAllowedTools(AgentRole.Implementer, commands);
  return [...new Set([...testerTools, ...implTools])];
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
