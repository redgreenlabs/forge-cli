# Forge CLI — Product Requirements Document

## Vision

Forge is a production-grade autonomous development orchestrator that drives Claude Code
through intelligent, multi-agent development loops with TDD, security hardening, and
software craftsmanship at every step. Unlike simple loop runners, Forge treats quality
as a first-class constraint — every iteration must produce tested, secure, documented,
and conventionally-committed code.

## Core Principles

1. **TDD First** — No code ships without a failing test first. Red-Green-Refactor is enforced.
2. **Conventional Commits** — Every working step produces a `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `security:` commit.
3. **Security by Default** — SAST, dependency audit, and secret scanning run on every iteration.
4. **Multi-Agent Architecture** — Specialized agents (architect, implementer, tester, reviewer, security) collaborate.
5. **Observable Execution** — Rich TUI with real-time progress, agent activity, test results, and coverage.
6. **Documentation as Code** — API docs, architecture decisions (ADRs), and changelogs auto-generated.
7. **Measurable Quality** — Coverage thresholds, complexity limits, and security scores enforced as gates.

## Target Users

- Solo developers wanting autonomous, high-quality development loops
- Teams wanting CI-integrated autonomous development with audit trails
- Security-conscious projects requiring continuous vulnerability scanning

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Forge CLI (TypeScript)                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌───────────┐  │
│  │ PRD      │  │ Loop      │  │ Agent    │  │ Quality   │  │
│  │ Manager  │  │ Engine    │  │ Orchestr.│  │ Gates     │  │
│  └──────────┘  └───────────┘  └──────────┘  └───────────┘  │
│                                                              │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌───────────┐  │
│  │ TDD      │  │ Security  │  │ Commit   │  │ TUI       │  │
│  │ Enforcer │  │ Scanner   │  │ Manager  │  │ Dashboard │  │
│  └──────────┘  └───────────┘  └──────────┘  └───────────┘  │
│                                                              │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐                 │
│  │ Doc      │  │ Circuit   │  │ Session  │                 │
│  │ Generator│  │ Breaker   │  │ Manager  │                 │
│  └──────────┘  └───────────┘  └──────────┘                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Technology Stack

- **Language**: TypeScript (strict mode, ESM)
- **Runtime**: Node.js >= 20
- **Build**: tsup (fast, zero-config)
- **Test**: Vitest (fast, TypeScript-native)
- **TUI**: Ink (React for CLIs) + ink-spinner + ink-table
- **CLI Framework**: Commander.js
- **Logging**: pino (structured JSON logs)
- **Schema Validation**: Zod
- **Package Manager**: npm

---

## User Stories

### Epic 1: Project Foundation

**US-1.1: Project Scaffolding**
As a developer, I want `forge init` to scaffold a new Forge project so that I can start using Forge quickly.
- Creates `.forge/` directory with config, prompts, and specs
- Generates `forge.config.ts` with sensible defaults
- Detects project type (Node, Python, Rust, Go) and configures accordingly
- Acceptance: `forge init` creates valid project structure; unit tests pass

**US-1.2: Configuration Schema**
As a developer, I want a typed, validated configuration so that misconfigurations are caught early.
- Zod schema for all config options
- Environment variable overrides
- `.forge/forge.config.ts` as primary config
- Acceptance: Invalid configs produce clear error messages; schema tests pass

**US-1.3: CLI Entry Point**
As a developer, I want a `forge` CLI with subcommands so that I can control the tool.
- Commands: `init`, `run`, `status`, `import`, `agents`, `report`
- `--help` with examples for every command
- Version display from package.json
- Acceptance: All commands parse correctly; help text renders; CLI tests pass

### Epic 2: PRD Management

**US-2.1: PRD Import**
As a developer, I want `forge import <file>` to import PRDs in Markdown, JSON, or text format.
- Parse PRD into structured task list
- Extract user stories, acceptance criteria, dependencies
- Generate `.forge/prd.json` and `.forge/tasks.md`
- Acceptance: Import 3 formats correctly; round-trip tests pass

**US-2.2: PRD Interactive Creation**
As a developer, I want `forge init --interactive` to guide me through PRD creation.
- Prompted questions for project vision, stack, constraints
- Template-based generation
- Acceptance: Interactive flow produces valid PRD; snapshot tests pass

**US-2.3: Task Dependency Graph**
As a developer, I want tasks to have explicit dependencies so that Forge executes them in order.
- DAG-based task ordering
- Dependency cycle detection
- Parallel-safe independent tasks
- Acceptance: Cycle detection throws; topological sort tests pass

### Epic 3: Multi-Agent Orchestration

**US-3.1: Agent Role System**
As a developer, I want specialized agent roles so that each aspect of development gets expert attention.
- Roles: Architect, Implementer, Tester, Reviewer, Security Auditor, Documenter
- Each role has a system prompt, allowed tools, and quality criteria
- Role rotation per loop iteration based on task type
- Acceptance: Agent selection logic tested; role prompts validated

**US-3.2: Agent Communication Protocol**
As a developer, I want agents to share context so that work is coherent across roles.
- Shared context file (`.forge/context.json`) with structured handoff
- Agent output → next agent input pipeline
- Conflict resolution when agents disagree
- Acceptance: Handoff protocol tests pass; conflict scenarios covered

**US-3.3: Agent Team Composition**
As a developer, I want to configure which agents participate so that I can customize the workflow.
- Default team: Architect → Implementer → Tester → Reviewer
- Configurable via `forge.config.ts`
- Solo mode (single agent) for simple tasks
- Acceptance: Team composition tests pass; config validation works

### Epic 4: TDD Enforcement

**US-4.1: Red-Green-Refactor Loop**
As a developer, I want Forge to enforce TDD so that every feature has tests first.
- Phase 1 (Red): Agent writes failing test
- Phase 2 (Green): Agent writes minimal code to pass
- Phase 3 (Refactor): Agent improves code quality
- Each phase produces a conventional commit
- Acceptance: TDD cycle detection tests pass; commit history shows R-G-R

**US-4.2: Coverage Gate**
As a developer, I want minimum coverage thresholds so that untested code blocks progress.
- Configurable thresholds (default: 80% line, 70% branch)
- Coverage delta tracking (no regression allowed)
- Integration with Vitest/Jest/pytest coverage reporters
- Acceptance: Gate blocks on low coverage; threshold tests pass

**US-4.3: Test Quality Analysis**
As a developer, I want test quality metrics so that I avoid meaningless tests.
- Mutation testing integration (Stryker for JS/TS)
- Test-to-code ratio tracking
- Flaky test detection
- Acceptance: Quality metrics computed correctly; flaky detection works

### Epic 5: Security Enforcement

**US-5.1: SAST Integration**
As a developer, I want static analysis on every iteration so that vulnerabilities are caught early.
- Integration with Semgrep (language-agnostic)
- Custom rule sets for OWASP Top 10
- Severity-based blocking (critical/high block, medium warn)
- Acceptance: SAST runs on test fixtures; findings parsed correctly

**US-5.2: Dependency Audit**
As a developer, I want dependency scanning so that vulnerable packages are flagged.
- `npm audit` / `pip audit` / `cargo audit` integration
- Known vulnerability database check
- License compliance check
- Acceptance: Audit results parsed; blocking logic tested

**US-5.3: Secret Scanning**
As a developer, I want secret detection so that credentials never get committed.
- Pre-commit secret scanning (gitleaks/trufflehog patterns)
- Pattern matching for API keys, tokens, passwords
- Block commit if secrets detected
- Acceptance: Secret patterns detected in test fixtures; no false negatives

### Epic 6: Conventional Commits

**US-6.1: Commit Classification**
As a developer, I want automatic commit type detection so that commits follow conventions.
- Analyze diff to determine: feat, fix, test, docs, refactor, security, chore
- Scope detection from file paths
- Breaking change detection
- Acceptance: Classification tests cover all types; edge cases handled

**US-6.2: Commit Orchestration**
As a developer, I want atomic commits per logical change so that history is clean.
- One commit per TDD phase (test, implementation, refactor)
- Squash option for completed features
- Commit message includes task reference
- Acceptance: Commit history tests verify atomicity

**US-6.3: Changelog Generation**
As a developer, I want automatic changelog updates so that releases are documented.
- Parse conventional commits into CHANGELOG.md
- Semantic versioning suggestions
- Breaking change highlights
- Acceptance: Changelog generation tests pass; format matches keep-a-changelog

### Epic 7: TUI Dashboard

**US-7.1: Main Dashboard View**
As a developer, I want a rich terminal UI so that I can monitor Forge execution.
- Real-time loop iteration counter
- Current agent and phase indicator
- Task progress bar (completed/total)
- Test results summary (pass/fail/skip)
- Coverage percentage with trend arrow
- Security findings count
- Acceptance: TUI renders correctly; snapshot tests pass

**US-7.2: Agent Activity Log**
As a developer, I want to see what each agent is doing so that I understand progress.
- Scrollable log panel with agent-colored entries
- File modification indicators
- Tool usage tracking
- Acceptance: Log entries render with correct colors; scroll works

**US-7.3: Quality Metrics Panel**
As a developer, I want a metrics panel so that I see quality at a glance.
- Coverage: line%, branch%, function%
- Security: critical/high/medium/low findings
- Complexity: average cyclomatic complexity
- Test ratio: tests/source files
- Acceptance: Metrics compute and render correctly

**US-7.4: Error and Warning Panel**
As a developer, I want errors and warnings highlighted so that I can intervene quickly.
- Circuit breaker status (CLOSED/HALF_OPEN/OPEN)
- Rate limit remaining
- Permission denials
- Build/test failures
- Acceptance: Error states render with correct severity colors

### Epic 8: Loop Engine

**US-8.1: Core Loop Execution**
As a developer, I want `forge run` to execute the development loop so that work proceeds autonomously.
- Configurable max iterations
- Rate limiting with backoff
- Graceful shutdown on SIGINT/SIGTERM
- Session continuity across restarts
- Acceptance: Loop executes N iterations; shutdown tests pass

**US-8.2: Circuit Breaker**
As a developer, I want stagnation detection so that stuck loops are halted.
- No-progress detection (N loops without file changes)
- Repeated error detection
- Output decline detection
- Auto-recovery with cooldown
- Acceptance: All circuit breaker states tested; transitions verified

**US-8.3: Quality Gate Pipeline**
As a developer, I want quality gates between phases so that bad code doesn't accumulate.
- Gate 1: Tests pass (TDD green phase)
- Gate 2: Coverage threshold met
- Gate 3: No critical security findings
- Gate 4: Linting passes
- Gate 5: Conventional commit valid
- Configurable gate severity (block vs warn)
- Acceptance: Each gate tested independently; pipeline integration tested

### Epic 9: Documentation Generation

**US-9.1: API Documentation**
As a developer, I want auto-generated API docs so that the codebase is documented.
- TypeDoc/JSDoc integration
- Function signature extraction
- Usage example generation
- Acceptance: Docs generate from test fixtures; output validates

**US-9.2: Architecture Decision Records**
As a developer, I want ADRs tracked so that decisions are documented.
- ADR template generation
- Status tracking (proposed, accepted, deprecated, superseded)
- Cross-reference with commits
- Acceptance: ADR CRUD operations tested; template renders correctly

**US-9.3: Project Health Report**
As a developer, I want `forge report` to generate a health summary so that I can assess quality.
- Coverage trends over time
- Security finding trends
- Commit frequency and type distribution
- Test suite health (flaky tests, slow tests)
- Output formats: terminal, HTML, JSON
- Acceptance: Report generation tested; all formats render

---

## Non-Functional Requirements

### Performance
- CLI startup < 500ms
- TUI renders at 30fps minimum
- Loop iteration overhead < 2s (excluding Claude execution)

### Reliability
- Graceful handling of Claude API failures
- State recovery after crashes
- Atomic file operations (no partial writes)

### Security
- No secrets in logs or state files
- Minimal file permissions on state directory
- Tool permission sandboxing

### Extensibility
- Plugin system for custom quality gates
- Custom agent role definitions
- Hook system for pre/post iteration events

---

## Success Metrics

- 90%+ test coverage on Forge itself
- Zero critical security findings in Forge codebase
- All commits follow conventional commit format
- Complete API documentation
- < 3s loop overhead per iteration
