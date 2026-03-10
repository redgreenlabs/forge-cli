# Forge CLI — Development Guide

## Quick Reference

```bash
npm test              # Run all 252 tests
npm run test:coverage # Run with coverage report (95%+ statements)
npm run typecheck     # TypeScript strict mode check
npm run build         # Build with tsup
```

## Architecture

Forge is a TypeScript ESM project using strict mode. 20 source modules:

### Core Loop
- `src/loop/engine.ts` — Loop state machine with 8 phases and stop conditions
- `src/loop/circuit-breaker.ts` — Nygard circuit breaker (CLOSED/HALF_OPEN/OPEN)
- `src/loop/orchestrator.ts` — Ties agents, TDD, gates, and loop together
- `src/loop/runner.ts` — High-level run with abort signal and error collection
- `src/loop/executor.ts` — Claude Code CLI arg builder and response parser
- `src/loop/session.ts` — Session persistence, expiry, and history

### Configuration
- `src/config/schema.ts` — Zod-validated config with sensible defaults
- `src/config/loader.ts` — File + env var loading with deep merge

### Commands
- `src/commands/init.ts` — Project scaffolding (detects Node/Python/Rust/Go)
- `src/commands/import.ts` — PRD import (Markdown/JSON) with task extraction

### PRD & Tasks
- `src/prd/parser.ts` — PRD parsing with priority, dependency, acceptance criteria
- `src/prd/task-graph.ts` — DAG with topological sort, cycle detection, critical path

### Agents
- `src/agents/roles.ts` — 6 roles with system prompts, tool permissions, task matching

### Quality
- `src/gates/quality-gates.ts` — Blocking/warning pipeline
- `src/tdd/enforcer.ts` — Red-Green-Refactor enforcement
- `src/security/scanner.ts` — Secret detection (AWS, passwords, keys, etc.)
- `src/commits/classifier.ts` — Conventional commit classification/validation

### Documentation
- `src/docs/changelog.ts` — Changelog generation from commits + version suggestion
- `src/docs/adr.ts` — Architecture Decision Records CRUD

### UI
- `src/tui/renderer.ts` — Colored terminal dashboard panels

## Conventions

- **TDD**: Write tests first in `tests/<module>/<name>.test.ts`
- **Commits**: Conventional format (feat:, fix:, test:, docs:, refactor:, security:)
- **Coverage**: Minimum 80% lines, 70% branches
- **TypeScript**: Strict mode, no `any`, no unused variables
- **Imports**: Use `.js` extension for ESM imports
- **Tests**: Vitest with `describe/it/expect`. Cover happy path, edge cases, errors, serialization.
