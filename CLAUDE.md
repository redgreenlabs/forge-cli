# Forge CLI — Development Guide

## Quick Reference

```bash
npm test              # Run all 437 tests
npm run test:coverage # Run with coverage report (94%+ statements)
npm run typecheck     # TypeScript strict mode check
npm run build         # Build with tsup
```

## Architecture

Forge is a TypeScript ESM project using strict mode. 38 source modules across 38 test suites:

### Core Loop
- `src/loop/engine.ts` — Loop state machine with 8 phases and stop conditions
- `src/loop/circuit-breaker.ts` — Nygard circuit breaker (CLOSED/HALF_OPEN/OPEN)
- `src/loop/orchestrator.ts` — Ties agents, TDD, gates, and loop together
- `src/loop/runner.ts` — High-level run with abort signal and error collection
- `src/loop/executor.ts` — Claude Code CLI arg builder and response parser
- `src/loop/session.ts` — Session persistence, expiry, and history
- `src/loop/rate-limiter.ts` — Sliding-window rate limiter with serialization
- `src/loop/hooks.ts` — 8 lifecycle events with registry and error collection

### Configuration
- `src/config/schema.ts` — Zod-validated config with sensible defaults
- `src/config/loader.ts` — File + env var loading with deep merge

### Commands
- `src/commands/init.ts` — Project scaffolding (detects Node/Python/Rust/Go)
- `src/commands/import.ts` — PRD import (Markdown/JSON) with task extraction
- `src/commands/run.ts` — Run context preparation (config + tasks + prompt)
- `src/commands/interactive-prd.ts` — Guided PRD generation from answers

### PRD & Tasks
- `src/prd/parser.ts` — PRD parsing with priority, dependency, acceptance criteria
- `src/prd/task-graph.ts` — DAG with topological sort, cycle detection, critical path

### Agents
- `src/agents/roles.ts` — 6 roles with system prompts, tool permissions, task matching
- `src/agents/handoff.ts` — Inter-agent communication protocol with priority and conflicts
- `src/agents/team.ts` — Team composition presets, rotation, and pipeline ordering
- `src/agents/context-file.ts` — Persistent shared context via .forge/context.json

### Quality
- `src/gates/quality-gates.ts` — Blocking/warning pipeline
- `src/gates/plugin.ts` — Gate plugin registry with 5 builtins (tests, coverage, security, lint, commit)
- `src/gates/dep-audit-gate.ts` — Dependency audit gate plugin (npm/pip/cargo)
- `src/tdd/enforcer.ts` — Red-Green-Refactor enforcement
- `src/commits/classifier.ts` — Conventional commit classification/validation
- `src/commits/orchestrator.ts` — TDD phase-based commit planning, scope detection, squash

### Security
- `src/security/scanner.ts` — Secret detection (AWS, passwords, keys, connection strings, etc.)
- `src/security/sast.ts` — SAST vulnerability scanner (SQL injection, XSS, command injection, path traversal, eval, insecure random)
- `src/security/dep-audit.ts` — Dependency audit parsers (npm, pip-audit, cargo-audit)

### Documentation
- `src/docs/changelog.ts` — Changelog generation from commits + version suggestion
- `src/docs/adr.ts` — Architecture Decision Records CRUD
- `src/docs/report.ts` — Health report generation (terminal, JSON, HTML)

### UI
- `src/tui/renderer.ts` — Static colored terminal dashboard panels
- `src/tui/live-dashboard.tsx` — Ink React live TUI with spinner and progress
- `src/tui/error-panel.ts` — Error/warning panel with severity sorting and system status

### Logging
- `src/logging/logger.ts` — Pino structured logger with file transport and module children

### Entry Points
- `src/cli.ts` — Commander.js CLI with 6 commands (init, import, run, status, report, agents)
- `src/index.ts` — Public API barrel file

## Conventions

- **TDD**: Write tests first in `tests/<module>/<name>.test.ts`
- **Commits**: Conventional format (feat:, fix:, test:, docs:, refactor:, security:)
- **Coverage**: Minimum 80% lines, 70% branches
- **TypeScript**: Strict mode, no `any`, no unused variables
- **Imports**: Use `.js` extension for ESM imports
- **Tests**: Vitest with `describe/it/expect`. Cover happy path, edge cases, errors, serialization.
