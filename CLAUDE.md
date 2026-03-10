# Forge CLI — Development Guide

## Quick Reference

```bash
npm test              # Run all 160 tests
npm run test:coverage # Run with coverage report
npm run typecheck     # TypeScript strict mode check
npm run build         # Build with tsup
```

## Architecture

Forge is a TypeScript ESM project using strict mode. Key modules:

- `src/config/schema.ts` — Zod-validated configuration with sensible defaults
- `src/prd/parser.ts` — PRD import (Markdown/JSON) with task extraction
- `src/prd/task-graph.ts` — DAG-based task ordering with cycle detection
- `src/agents/roles.ts` — Multi-agent role system (6 roles with prompts/tools)
- `src/loop/engine.ts` — Loop state machine with phase tracking
- `src/loop/circuit-breaker.ts` — Nygard circuit breaker pattern
- `src/loop/orchestrator.ts` — Ties agents, TDD, gates, and loop together
- `src/tdd/enforcer.ts` — Red-Green-Refactor enforcement
- `src/gates/quality-gates.ts` — Blocking/warning quality gate pipeline
- `src/commits/classifier.ts` — Conventional commit classification/validation
- `src/security/scanner.ts` — Secret detection (AWS keys, passwords, etc.)
- `src/tui/renderer.ts` — Colored terminal dashboard

## Conventions

- **TDD**: Write tests first, then implementation
- **Commits**: Use conventional commits (feat:, fix:, test:, docs:, refactor:, security:, chore:)
- **Tests**: Vitest with `describe/it/expect`. Tests live in `tests/` mirroring `src/`
- **Coverage**: Minimum 80% lines, 70% branches
- **TypeScript**: Strict mode, no `any`, no unused variables
- **Imports**: Use `.js` extension for ESM imports

## Testing

All test files follow the pattern `tests/<module>/<name>.test.ts`.
Tests should cover: happy path, edge cases, error cases, serialization.
