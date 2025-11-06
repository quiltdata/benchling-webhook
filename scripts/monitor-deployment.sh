#!/bin/bash

# Monitor deployment health every minute
# Usage: bash scripts/monitor-deployment.sh

while true; do
  clear
  echo "=== Deployment Health Check - $(date) ==="
  echo ""

  # Get stack info
  npm run deploy:logs 2>&1 | grep -A 10 "Benchling Webhook Stack Information"

  echo ""
  echo "=== Recent Health Checks (last 5) ==="
  npm run deploy:logs 2>&1 | grep "GET /health" | tail -5

  echo ""
  echo "=== Any Errors? ==="
  npm run deploy:logs 2>&1 | grep -i "error\|exception\|failed" | tail -5 || echo "No errors found"

  echo ""
  echo "Next check in 60 seconds... (Ctrl+C to stop)"
  sleep 60
done
