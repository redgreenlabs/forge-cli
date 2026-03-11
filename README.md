# Forge CLI

Autonomous multi-agent development orchestrator with TDD, security, and software craftsmanship.

Forge drives Claude Code through intelligent development loops where specialized agents collaborate, tests are written before code, security scans run every iteration, and every change produces a conventional commit.

## Features

- **Multi-Agent Teams** — 6 specialized roles (Architect, Implementer, Tester, Reviewer, Security, Documenter) with automatic task-to-agent matching
- **TDD Enforcement** — Red-Green-Refactor cycle tracked and enforced with violation detection
- **Quality Gates** — 5-gate pipeline (tests, coverage, security, lint, commit) with blocking/warning severity
- **Security Scanning** — Secret detection, SAST integration, dependency audit on every iteration
- **Conventional Commits** — Automatic commit classification and validation at each working step
- **Rich TUI Dashboard** — Real-time progress, agent activity, test results, coverage trends, security findings
- **PRD Import** — Import requirements from Markdown or JSON, with dependency graph and topological ordering
- **Circuit Breaker** — Stagnation detection (no-progress, repeated errors) with auto-recovery
- **Session Continuity** — Resume loops across restarts with persistent session state
- **Documentation** — Auto-generated changelogs, Architecture Decision Records (ADRs), health reports

## Quick Start

```bash
# Install
npm install -g forge-cli

# Initialize a project
forge init --name my-project

# Import a PRD
forge import requirements.md

# Start the development loop
forge run --iterations 20

# Preview the dashboard without executing
forge run --dry-run

# Check status
forge status

# List agents
forge agents
```

## Commands

| Command | Description |
|---------|-------------|
| `forge init` | Initialize a new Forge project (creates `.forge/` directory) |
| `forge import <file>` | Import a PRD from Markdown, JSON, or text |
| `forge run` | Start the autonomous development loop |
| `forge status` | Show current session and quality metrics |
| `forge report` | Generate a project health report |
| `forge agents` | List and configure agent roles |

### `forge run` Options

```
-n, --iterations <n>  Maximum iterations (default: 50)
--no-tui              Disable TUI dashboard (plain text output)
--solo                Single agent mode
--dry-run             Preview dashboard without running Claude
```

## Configuration

Forge uses `.forge/forge.config.json` for project-level settings:

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
    "branchThreshold": 70,
    "functionThreshold": 80,
    "noRegression": true
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
├── agents/          # Multi-agent role system
│   └── roles.ts     # 6 agent definitions with prompts and tool permissions
├── commands/        # CLI command implementations
│   ├── init.ts      # Project scaffolding
│   └── import.ts    # PRD import
├── commits/         # Conventional commit management
│   └── classifier.ts # Auto-classification and validation
├── config/          # Configuration management
│   ├── schema.ts    # Zod-validated config schema
│   └── loader.ts    # File + env var config loading
├── docs/            # Documentation generation
│   ├── adr.ts       # Architecture Decision Records
│   └── changelog.ts # Changelog from conventional commits
├── gates/           # Quality enforcement
│   ├── quality-gates.ts # 5-gate pipeline
│   └── plugin.ts    # Gate plugin registry with builtins
├── loop/            # Core loop engine
│   ├── engine.ts    # State machine with 8 phases
│   ├── circuit-breaker.ts # Nygard pattern
│   ├── executor.ts  # Claude Code CLI integration
│   ├── orchestrator.ts # Agent + TDD + gates coordination
│   ├── runner.ts    # High-level loop runner
│   ├── session.ts   # Session persistence
│   ├── rate-limiter.ts # Sliding-window rate limiter
│   └── hooks.ts     # Lifecycle hook registry
├── prd/             # PRD management
│   ├── parser.ts    # Markdown/JSON parsing
│   └── task-graph.ts # DAG with topological sort
├── security/        # Security scanning
│   ├── scanner.ts   # Secret detection
│   └── sast.ts      # SAST vulnerability scanner
├── tdd/             # TDD enforcement
│   └── enforcer.ts  # Red-Green-Refactor tracking
├── tui/             # Terminal UI
│   ├── renderer.ts  # Static dashboard panels
│   └── live-dashboard.tsx # Ink React live TUI
├── cli.ts           # CLI entry point (6 commands)
└── index.ts         # Public API exports
```

## Development

```bash
npm install          # Install dependencies
npm test             # Run 314 tests
npm run test:coverage # Run with coverage (93%+ statements)
npm run typecheck    # TypeScript strict mode check
npm run build        # Build with tsup
```

## Quality Metrics

- **314 tests** across 25 test suites
- **93.8%** statement coverage
- **85.8%** branch coverage
- **TypeScript strict mode** with no `any` types
- **Conventional commits** throughout history
- **Zero runtime dependencies** beyond chalk, commander, ink, pino, zod

## License

MIT
