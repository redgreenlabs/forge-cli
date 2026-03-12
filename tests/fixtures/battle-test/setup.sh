#!/bin/bash
# Creates a small test project for battle-testing forge run against real Claude Code.
#
# Usage:
#   cd /tmp && bash /path/to/setup.sh
#   cd forge-battle-test
#   forge run --iterations 3

set -e

PROJECT="forge-battle-test"

rm -rf "$PROJECT"
mkdir -p "$PROJECT"
cd "$PROJECT"

# Init git
git init
git config user.email "test@forge.dev"
git config user.name "Forge Test"

# Gitignore
cat > .gitignore << 'GITIGNORE'
node_modules/
dist/
.forge/context.json
.forge/session.json
.forge/session-history.json
.forge/logs/
GITIGNORE

# Create a minimal Node/TypeScript project
cat > package.json << 'PKGJSON'
{
  "name": "forge-battle-test",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "npx vitest run",
    "build": "npx tsc --noEmit",
    "lint": "echo 'lint ok'"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
PKGJSON

cat > tsconfig.json << 'TSCONF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
TSCONF

cat > vitest.config.ts << 'VITEST'
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
VITEST

mkdir -p src

cat > src/index.ts << 'INDEX'
/**
 * A simple greeting library.
 * This is the starting point — Forge should build on top of this.
 */
export function hello(): string {
  return "Hello, World!";
}
INDEX

npm install

git add -A
git commit -m "initial: minimal TypeScript project"

# Now init Forge
echo ""
echo "=== Initializing Forge ==="
forge init --name "forge-battle-test"

# Create a focused PRD with 2 small tasks
cat > .forge/specs/prd.md << 'PRD'
# Forge Battle Test PRD

## Overview
A small greeting/farewell library to validate the Forge autonomous loop.

## Features

- [ ] [greet] Add personalized greeting function [HIGH]
  - Accept a name parameter (string)
  - Return "Hello, <name>!" format
  - Handle empty string by defaulting to "World"
  - Write tests first (TDD)

- [ ] [farewell] Add farewell function [MEDIUM] (depends: greet)
  - Accept a name parameter (string)
  - Return "Goodbye, <name>!" format
  - Handle empty string by defaulting to "World"
  - Write tests first (TDD)
PRD

# Import the PRD
forge import .forge/specs/prd.md

git add -A
git commit -m "chore: forge init and import PRD"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Project: $(pwd)"
echo "Tasks:   2 (greet → farewell)"
echo ""
echo "To run:"
echo "  cd $(pwd)"
echo "  forge run --iterations 3"
echo ""
echo "To run with dashboard disabled:"
echo "  forge run --iterations 3 --no-tui"
echo ""
echo "To do a dry run first:"
echo "  forge run --dry-run"
