#!/usr/bin/env bash
# Wrapper script to call Python CLI from any directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT/docker" && uv run python scripts/benchling-webhook-config "$@"
