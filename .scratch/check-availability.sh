#!/bin/bash

echo "Checking if @quiltdata/benchling-webhook@0.4.13 is available on npm..."
echo ""

MAX_ATTEMPTS=30
ATTEMPT=1
SLEEP_TIME=10

while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
  echo "Attempt $ATTEMPT/$MAX_ATTEMPTS..."

  if npm view @quiltdata/benchling-webhook@0.4.13 version &>/dev/null; then
    echo ""
    echo "✅ Package is available!"
    echo ""
    npm view @quiltdata/benchling-webhook@0.4.13
    echo ""
    echo "You can now run: npm install && npm test"
    exit 0
  else
    echo "   Not available yet, waiting ${SLEEP_TIME} seconds..."
    sleep $SLEEP_TIME
    ATTEMPT=$((ATTEMPT + 1))
  fi
done

echo ""
echo "❌ Package not available after $MAX_ATTEMPTS attempts."
echo "Please check:"
echo "  1. Was the package published successfully?"
echo "  2. Is the @quiltdata org configured for public access?"
echo "  3. Try manually: npm view @quiltdata/benchling-webhook"
exit 1
