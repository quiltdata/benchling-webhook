#!/bin/bash
# Test minimal startup with no valid secrets - mirrors CI workflow
# This should reproduce the exact failure seen in GitHub Actions

set -e

echo "🧪 Testing minimal Docker startup (CI simulation)"
echo ""
echo "This test mirrors the exact environment from GitHub Actions CI:"
echo "- Minimal environment variables"
echo "- No valid AWS Secrets Manager secret"
echo "- No AWS credentials"
echo ""

# Always build fresh Docker image to ensure latest changes are included
echo "📦 Building fresh Docker image..."
make -C docker docker-build-local

# Use the local image
IMAGE_URI="benchling-webhook:latest"

echo "🐳 Starting container with minimal config (no valid secrets)..."
echo ""

# Run container with minimal config to test startup (mirrors CI exactly)
CONTAINER_ID=$(docker run -d \
  -e PORT=8080 \
  -e AWS_REGION=us-east-1 \
  -e PACKAGER_SQS_URL=https://sqs.us-east-1.amazonaws.com/000000000000/test-queue \
  -e QUILT_WEB_HOST=https://example.quiltdata.com \
  -e ATHENA_USER_DATABASE=test_db \
  -e BenchlingSecret=test-secret \
  ${IMAGE_URI})

echo "Container ID: $CONTAINER_ID"
echo ""

# Wait up to 30 seconds for container to start
echo "⏳ Waiting for Gunicorn to start (max 30 seconds)..."
for i in $(seq 1 30); do
  sleep 1
  if docker logs ${CONTAINER_ID} 2>&1 | grep -q "Booting worker with pid"; then
    echo ""
    echo "✅ Gunicorn started successfully!"
    echo ""
    echo "=== Container Logs ==="
    docker logs ${CONTAINER_ID}
    echo "=== End Logs ==="
    echo ""

    # Test health endpoint
    echo "🏥 Testing health endpoint..."
    if curl -s http://localhost:8080/health | jq . 2>/dev/null; then
      echo ""
      echo "✅ Health check passed!"
    else
      echo "❌ Health check failed"
    fi

    docker stop ${CONTAINER_ID} >/dev/null 2>&1 || true
    docker rm ${CONTAINER_ID} >/dev/null 2>&1 || true
    echo ""
    echo "✅ Test passed - container started in degraded mode"
    exit 0
  fi
  printf "."
done

echo ""
echo ""
echo "❌ Gunicorn did not start within 30 seconds"
echo ""
echo "=== Container Logs ==="
docker logs ${CONTAINER_ID}
echo "=== End Logs ==="
echo ""
docker stop ${CONTAINER_ID} >/dev/null 2>&1 || true
docker rm ${CONTAINER_ID} >/dev/null 2>&1 || true
echo "❌ Test failed - container did not start"
exit 1
