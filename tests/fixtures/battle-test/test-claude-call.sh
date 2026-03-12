#!/bin/bash
# Quick diagnostic: tests if claude CLI works with forge-like arguments.
# Run from any directory. Requires `claude` CLI to be installed and authenticated.
#
# Usage: bash test-claude-call.sh

set -e

echo "=== Test 1: Simple prompt ==="
time claude -p "Say hello in one word" --output-format json --dangerously-skip-permissions 2>/dev/null | head -c 200
echo ""
echo ""

echo "=== Test 2: Multiline prompt (like forge TDD) ==="
PROMPT="[TDD RED PHASE] Write a failing test for:
Task: Add personalized greeting function
Acceptance criteria: Accept a name parameter, Return Hello format

Write ONLY the test. Do NOT implement the feature yet."

time claude -p "$PROMPT" --output-format json --dangerously-skip-permissions 2>/dev/null | head -c 500
echo ""
echo ""

echo "=== Test 3: With --append-system-prompt (like forge agent) ==="
SYSTEM="You are the Tester agent. Write failing tests first. Focus on edge cases."

time claude -p "$PROMPT" \
  --append-system-prompt "$SYSTEM" \
  --output-format json \
  --dangerously-skip-permissions 2>/dev/null | head -c 500
echo ""
echo ""

echo "=== Test 4: With --allowedTools (like forge sandbox) ==="
time claude -p "$PROMPT" \
  --append-system-prompt "$SYSTEM" \
  --allowedTools "Read,Write,Edit,Glob,Grep,Bash(npm run test)" \
  --output-format json \
  --dangerously-skip-permissions 2>/dev/null | head -c 500
echo ""
echo ""

echo "=== Test 5: Full forge-like invocation with budget cap ==="
time claude -p "$PROMPT" \
  --append-system-prompt "$SYSTEM" \
  --allowedTools "Read,Write,Edit,Glob,Grep,Bash(npm run test)" \
  --output-format json \
  --dangerously-skip-permissions \
  --max-budget-usd 0.50 2>/dev/null | head -c 500
echo ""
echo ""

echo "=== All tests completed ==="
