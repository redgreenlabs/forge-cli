# Forge CLI

Autonomous multi-agent development orchestrator that drives Claude Code through TDD loops with security scanning and conventional commits.

You describe what to build. Forge builds it — test-first, secure, and documented.

## Features

- **TDD Enforcement** — Red-Green-Refactor cycle tracked and enforced. Tests are written before code, every time.
- **Multi-Agent Teams** — 6 specialized roles (Architect, Implementer, Tester, Reviewer, Security, Documenter) with automatic task-to-agent matching
- **Quality Gates** — 5-gate pipeline (tests, coverage, security, lint, commit) with blocking/warning severity
- **Security Scanning** — Secret detection, SAST, dependency audit on every iteration
- **Conventional Commits** — Automatic commit per TDD phase (`test:`, `feat:`, `refactor:`)
- **Live TUI Dashboard** — Real-time progress, agent activity, TDD phase, circuit breaker status
- **Spec-Kit Integration** — Use [GitHub's spec-kit](https://github.com/github/spec-kit) for planning, Forge for execution
- **Circuit Breaker** — Stagnation detection with auto-recovery (Nygard pattern)
- **Session Continuity** — Resume loops across restarts with persistent state

## Quick Start

```bash
# Install
npm install -g @redgreen-labs/forge-cli

# Initialize a project
forge init --name my-project

# Import requirements
forge import requirements.md

# Start the development loop
forge run --iterations 20

# Check progress
forge status
```

## Task Sources

Forge supports three task formats, auto-detected in priority order:

### 1. Spec-Kit (recommended for new projects)

Use [spec-kit](https://github.com/github/spec-kit) for the planning phase, then Forge for execution:

```bash
# Generate specs with spec-kit
npx spec-kit specify
npx spec-kit plan
npx spec-kit tasks

# Forge auto-detects specs/tasks.md
forge run
```

Forge reads from `specs/`:

| File | Purpose |
|------|---------|
| `specs/tasks.md` | Task list with T-IDs, phases, dependencies |
| `specs/constitution.md` | Project principles — injected into agent prompts |
| `specs/spec.md` | Detailed requirements — injected into agent prompts |
| `specs/plan.md` | Architecture decisions — injected into agent prompts |

Spec-kit task format:
```markdown
## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 [P] Initialize project structure
- [ ] T002 Configure CI pipeline (depends on T001)

## Phase 2: User Story 1 - Authentication (Priority: P1)

- [ ] T003 [US1] Implement login endpoint
  - Returns JWT token on success
  - Returns 401 on invalid credentials
```

Markers: `[P]` = parallelizable, `[US1]` = user story ref, `(depends on T001)` = dependency.

### 2. Forge PRD (JSON)

```bash
forge import requirements.md    # Parses to .forge/prd.json
forge run
```

### 3. Markdown Task List

```bash
# Place a tasks.md in .forge/
forge run
```

## Commands

| Command | Description |
|---------|-------------|
| `forge init` | Initialize a new Forge project |
| `forge import <file>` | Import a PRD from Markdown or JSON |
| `forge run` | Start the autonomous development loop |
| `forge status` | Show session progress and quality metrics |
| `forge report` | Generate a project health report |
| `forge agents` | List and configure agent roles |

### `forge run` Options

```
-n, --iterations <n>  Maximum iterations (default: 50)
--resume              Resume from previous run
--no-tui              Disable live TUI (plain text output)
--verbose             Show Claude CLI output
--solo                Single agent mode
--dry-run             Preview without running Claude
```

## How It Works

Each iteration follows this pipeline:

```
Select Task → TDD Red (write failing test)
            → TDD Green (implement to pass)
            → TDD Refactor (clean up)
            → Security Scan
            → Quality Gates
            → Conventional Commit
            → Next Task
```

The loop stops when all tasks are complete, max iterations reached, or the circuit breaker trips (repeated failures).

## Configuration

`.forge/forge.config.json`:

```json
{
  "maxIterations": 50,
  "maxCallsPerHour": 100,
  "timeoutMinutes": 15,
  "tdd": {
    "enabled": true,
    "requireFailingTestFirst": true,
    "commitPerPhase": true
  },
  "coverage": {
    "lineThreshold": 80,
    "branchThreshold": 70
  },
  "security": {
    "enabled": true,
    "sast": true,
    "dependencyAudit": true,
    "secretScanning": true,
    "blockOnSeverity": "high"
  },
  "agents": {
    "team": ["architect", "implementer", "tester", "reviewer"],
    "soloMode": false
  }
}
```

### Environment Variable Overrides

| Variable | Effect |
|----------|--------|
| `FORGE_MAX_ITERATIONS` | Override max loop iterations |
| `FORGE_MAX_CALLS_PER_HOUR` | Override API rate limit |
| `FORGE_TDD_ENABLED` | Enable/disable TDD enforcement |
| `FORGE_SECURITY_ENABLED` | Enable/disable security scanning |

## Architecture

```
src/
├── agents/          # Multi-agent role system (roles, handoff, teams)
├── commands/        # CLI commands (init, import, run, status, report)
├── commits/         # Conventional commit classification and planning
├── config/          # Zod-validated config with env var overrides
├── docs/            # Changelog and ADR generation
├── gates/           # Quality gate pipeline with plugin registry
├── loop/            # Core engine, orchestrator, executor, circuit breaker
├── prd/             # PRD parsing and task dependency graph (DAG)
├── security/        # Secret detection, SAST, dependency audit
├── speckit/         # Spec-kit format parser and context injection
├── tdd/             # Red-Green-Refactor enforcement
├── tui/             # Ink live dashboard and static renderer
├── cli.ts           # CLI entry point
└── index.ts         # Public API
```

## Development

```bash
npm install
npm test              # Run tests
npm run test:coverage # Coverage report
npm run typecheck     # TypeScript strict mode
npm run build         # Build with tsup
```

## Requirements

- Node.js >= 20
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## License

MIT
