# Forge CLI

Autonomous multi-agent development orchestrator that drives Claude Code through TDD loops with security scanning and conventional commits.

You describe what to build. Forge builds it — test-first, secure, and documented.

## Features

- **TDD Enforcement** — Red-Green-Refactor cycle tracked and enforced. Tests are written before code, every time.
- **Multi-Agent Teams** — 6 specialized roles (Architect, Implementer, Tester, Reviewer, Security, Documenter) with automatic task-to-agent matching
- **Quality Gates with Auto-Fix** — 5-gate pipeline (tests, coverage, security, lint, commit) with blocking/warning severity. When gates fail, Claude automatically attempts to fix the issues before giving up.
- **Security Scanning** — Secret detection, SAST, dependency audit on every iteration
- **Conventional Commits** — Automatic commit per TDD phase (`test:`, `feat:`, `refactor:`)
- **Live TUI Dashboard** — Real-time Claude output, cost tracking, TDD pipeline visualization, quality gate status. Press `d` for detailed dashboard overlay, `q` for graceful quit.
- **Cost Tracking** — Real-time cost per task, per execution, and per phase with averages
- **Smart Task Ordering** — Tasks sorted by priority (critical → low) and dependency graph depth (foundational tasks first)
- **Auto Task Decomposition** — Large complex tasks are automatically split into TDD-friendly subtasks
- **Session Continuity** — Unified TDD prompt preserves Claude's context across Red/Green/Refactor phases. Resume loops across restarts with persistent state.
- **Spec-Kit Integration** — Use [GitHub's spec-kit](https://github.com/github/spec-kit) for planning, Forge for execution
- **Circuit Breaker** — Stagnation detection with auto-recovery (Nygard pattern)
- **Stream Output** — Real-time structured JSON streaming from Claude CLI for live TUI feedback

## Quick Start

```bash
# Install
npm install -g @redgreen-labs/forge-cli

# Run inside your existing project directory
cd my-project
forge init

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
| `forge init` | Initialize project, auto-detect workspaces and language |
| `forge import <file>` | Import PRD, scan for existing implementations, auto-decompose |
| `forge run` | Start the autonomous development loop |
| `forge status` | Show session progress and quality metrics |
| `forge report` | Generate a project health report |
| `forge decompose` | Decompose large tasks into smaller TDD-friendly subtasks |
| `forge agents` | List available agent roles and their tools |

### `forge init` Options

```
-n, --name <name>     Project name
-i, --interactive     Guided PRD creation
-f, --force           Overwrite existing .forge directory
--no-scan             Skip workspace auto-detection
-v, --verbose         Show detailed scan output
```

### `forge import` Options

```
--no-scan             Skip codebase scan for existing implementations
--no-decompose        Skip automatic decomposition of large tasks
-v, --verbose         Show detailed scan output
```

### `forge run` Options

```
-n, --iterations <n>  Maximum iterations (default: 50)
--resume              Resume from previous run, skipping completed tasks
--no-tui              Disable live TUI (plain text output)
-v, --verbose         Show detailed executor output
--solo                Single agent mode (no team rotation)
--dry-run             Simulate execution without running Claude
```

### `forge status` Options

```
--json                Output as JSON
-w, --watch           Refresh status every few seconds
--interval <seconds>  Watch interval in seconds (default: 3)
```

### `forge report` Options

```
-f, --format <type>   Output format: terminal, html, or json (default: terminal)
```

### `forge decompose` Options

```
--threshold <n>       Complexity threshold 1-10 (tasks above this are decomposed)
--max-subtasks <n>    Max subtasks per parent task
--dry-run             Show which tasks would be decomposed without calling Claude
-v, --verbose         Show detailed output
```

## How It Works

Each iteration follows this pipeline:

```
Select Task → TDD Red (write failing test)
            → TDD Green (implement to pass)
            → TDD Refactor (clean up)
            → Security Scan
            → Quality Gates ──→ Pass → Commit → Next Task
                             └→ Fail → Auto-Fix → Re-run Gates (up to 3 retries)
```

Tasks are selected by priority (critical first) and dependency graph depth (foundational tasks that unblock others run first). The loop stops when all tasks are complete, max iterations reached, or the circuit breaker trips (repeated failures).

### TUI Dashboard

The live dashboard shows real-time progress:

```
╭──────────────── FORGE Development Loop ─────────────────╮
│                                                          │
├──────────────────────────────────────────────────────────┤
│ Phase: IMPLEMENTING   Tasks: 3/10   Iter: 5              │
│ Elapsed: 04:32   Cost: $0.45   Commits: 8   Files: 3    │
│                                                          │
│ [████████████░░] 85%                                     │
│ Task: Implement user authentication                      │
│                                                          │
│ ✓Red → ✓Green → ●Refactor → ○Gates (2 cycles)           │
│ Gates: ✓tests ✓security ✓lint ✗coverage                  │
├──────────────────────────────────────────────────────────┤
│ Claude Output                                            │
│ ⚡ Writing src/auth/login.ts...                           │
│ Running npm test -- --reporter verbose                   │
│ Tests  42 passed (42)                                    │
├──────────────────────────────────────────────────────────┤
│ [d] Dashboard  [q] Quit          ✓tests ✓sec ✓lint ✗cov │
╰──────────────────────────────────────────────────────────╯
```

Press `d` to toggle the dashboard overlay with cost breakdown, coverage, security findings, and code quality metrics.

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
├── gates/           # Quality gate pipeline with auto-fix retry
├── logging/         # Pino structured logger with file transport
├── loop/            # Core engine, orchestrator, executor, circuit breaker
├── metrics/         # Code complexity and test ratio analysis
├── prd/             # PRD parsing, task graph (DAG), auto-decomposition
├── security/        # Secret detection, SAST, dependency audit
├── speckit/         # Spec-kit format parser and context injection
├── tdd/             # Red-Green-Refactor enforcement
├── tui/             # Ink live dashboard with cost tracking and overlays
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
