#!/bin/bash

# Deployment script that captures CDK outputs to .env.deploy
# Usage: ./bin/deploy.sh [--skip-tests]

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_ENV_FILE="$PROJECT_ROOT/.env.deploy"

echo "========================================="
echo "Benchling Webhook Deployment Script"
echo "========================================="
echo ""

# Check if .env file exists
if [ ! -f "$PROJECT_ROOT/.env" ]; then
    echo "Error: .env file not found"
    echo "Please create a .env file with required configuration"
    exit 1
fi

# Source .env file
echo "Loading environment from .env..."
source "$PROJECT_ROOT/.env"

# Validate required environment variables
REQUIRED_VARS=(
    "CDK_DEFAULT_ACCOUNT"
    "CDK_DEFAULT_REGION"
    "BUCKET_NAME"
    "QUEUE_NAME"
    "PREFIX"
    "BENCHLING_TENANT"
    "BENCHLING_CLIENT_ID"
    "BENCHLING_CLIENT_SECRET"
)

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        echo "Error: Required environment variable $var is not set"
        exit 1
    fi
done

echo "✓ Environment validated"
echo ""

# Check if tests should be skipped
SKIP_TESTS=false
if [ "$1" == "--skip-tests" ]; then
    SKIP_TESTS=true
    echo "⚠ Skipping tests as requested"
else
    # Run tests
    echo "Running tests..."
    npm run test
    echo "✓ Tests passed"
fi
echo ""

# Deploy CDK stack
echo "Deploying CDK stack..."
echo "Region: $CDK_DEFAULT_REGION"
echo "Account: $CDK_DEFAULT_ACCOUNT"
echo ""

# Capture CDK outputs
OUTPUTS=$(npx cdk deploy --require-approval never --outputs-file "$PROJECT_ROOT/cdk-outputs.json" 2>&1 | tee /dev/tty)
DEPLOY_EXIT_CODE=$?

if [ $DEPLOY_EXIT_CODE -ne 0 ]; then
    echo ""
    echo "✗ Deployment failed"
    exit $DEPLOY_EXIT_CODE
fi

echo ""
echo "✓ Deployment completed successfully"
echo ""

# Parse outputs and create .env.deploy file
if [ -f "$PROJECT_ROOT/cdk-outputs.json" ]; then
    echo "Parsing CDK outputs..."

    # Extract outputs using jq or node
    if command -v jq &> /dev/null; then
        # Use jq if available
        WEBHOOK_ENDPOINT=$(jq -r '.BenchlingWebhookStack.WebhookEndpoint // empty' "$PROJECT_ROOT/cdk-outputs.json")
        API_URL=$(jq -r '.BenchlingWebhookStack.ApiUrl // empty' "$PROJECT_ROOT/cdk-outputs.json")
        DOCKER_IMAGE=$(jq -r '.BenchlingWebhookStack.DockerImageUri // empty' "$PROJECT_ROOT/cdk-outputs.json")
        STACK_VERSION=$(jq -r '.BenchlingWebhookStack.StackVersion // empty' "$PROJECT_ROOT/cdk-outputs.json")
        ALB_DNS=$(jq -r '.BenchlingWebhookStack.LoadBalancerDNS // empty' "$PROJECT_ROOT/cdk-outputs.json")
        SERVICE_NAME=$(jq -r '.BenchlingWebhookStack.ServiceName // empty' "$PROJECT_ROOT/cdk-outputs.json")
        CLUSTER_NAME=$(jq -r '.BenchlingWebhookStack.ClusterName // empty' "$PROJECT_ROOT/cdk-outputs.json")
    else
        # Fallback to node if jq is not available
        WEBHOOK_ENDPOINT=$(node -e "const fs=require('fs'); const o=JSON.parse(fs.readFileSync('$PROJECT_ROOT/cdk-outputs.json')); console.log(o.BenchlingWebhookStack?.WebhookEndpoint || '')")
        API_URL=$(node -e "const fs=require('fs'); const o=JSON.parse(fs.readFileSync('$PROJECT_ROOT/cdk-outputs.json')); console.log(o.BenchlingWebhookStack?.ApiUrl || '')")
        DOCKER_IMAGE=$(node -e "const fs=require('fs'); const o=JSON.parse(fs.readFileSync('$PROJECT_ROOT/cdk-outputs.json')); console.log(o.BenchlingWebhookStack?.DockerImageUri || '')")
        STACK_VERSION=$(node -e "const fs=require('fs'); const o=JSON.parse(fs.readFileSync('$PROJECT_ROOT/cdk-outputs.json')); console.log(o.BenchlingWebhookStack?.StackVersion || '')")
        ALB_DNS=$(node -e "const fs=require('fs'); const o=JSON.parse(fs.readFileSync('$PROJECT_ROOT/cdk-outputs.json')); console.log(o.BenchlingWebhookStack?.LoadBalancerDNS || '')")
        SERVICE_NAME=$(node -e "const fs=require('fs'); const o=JSON.parse(fs.readFileSync('$PROJECT_ROOT/cdk-outputs.json')); console.log(o.BenchlingWebhookStack?.ServiceName || '')")
        CLUSTER_NAME=$(node -e "const fs=require('fs'); const o=JSON.parse(fs.readFileSync('$PROJECT_ROOT/cdk-outputs.json')); console.log(o.BenchlingWebhookStack?.ClusterName || '')")
    fi

    # Create .env.deploy file
    cat > "$DEPLOY_ENV_FILE" << EOF
# Benchling Webhook Deployment Outputs
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
# Stack: BenchlingWebhookStack
# Region: $CDK_DEFAULT_REGION
# Account: $CDK_DEFAULT_ACCOUNT

# Webhook Configuration
WEBHOOK_ENDPOINT=$WEBHOOK_ENDPOINT
API_URL=$API_URL

# Infrastructure Details
DOCKER_IMAGE_URI=$DOCKER_IMAGE
STACK_VERSION=$STACK_VERSION
ALB_DNS_NAME=$ALB_DNS
ECS_SERVICE_NAME=$SERVICE_NAME
ECS_CLUSTER_NAME=$CLUSTER_NAME

# Deployment Info
DEPLOYED_AT=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
DEPLOYED_BY=$(whoami)
DEPLOYED_FROM=$(hostname)
CDK_REGION=$CDK_DEFAULT_REGION
CDK_ACCOUNT=$CDK_DEFAULT_ACCOUNT
EOF

    echo "✓ Deployment outputs saved to .env.deploy"
    echo ""

    # Display key outputs
    echo "========================================="
    echo "Deployment Summary"
    echo "========================================="
    echo ""
    echo "Webhook Endpoint:"
    echo "  $WEBHOOK_ENDPOINT"
    echo ""
    if [ -n "$API_URL" ]; then
        echo "API URL:"
        echo "  $API_URL"
        echo ""
    fi
    echo "Docker Image:"
    echo "  $DOCKER_IMAGE"
    echo ""
    echo "Stack Version:"
    echo "  $STACK_VERSION"
    echo ""
    echo "ECS Service:"
    echo "  Cluster: $CLUSTER_NAME"
    echo "  Service: $SERVICE_NAME"
    echo ""
    echo "Next Steps:"
    echo "1. Configure Benchling webhook URL:"
    echo "   $WEBHOOK_ENDPOINT"
    echo ""
    echo "2. Test the endpoint:"
    echo "   curl $WEBHOOK_ENDPOINT/health"
    echo ""
    echo "3. View deployment details:"
    echo "   cat .env.deploy"
    echo ""
    echo "========================================="

else
    echo "⚠ Warning: cdk-outputs.json not found"
    echo "Outputs may not have been captured properly"
fi

# Cleanup temporary files if needed
# rm -f "$PROJECT_ROOT/cdk-outputs.json"  # Uncomment to remove after parsing

echo ""
echo "Deployment complete!"
