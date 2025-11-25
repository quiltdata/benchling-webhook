# Benchling-Quilt Integration Makefile

# Configuration is now managed via XDG (~/.config/benchling-webhook/{profile}/)
# with unified config.json and deployments.json per profile (v0.7.0)

# Load .env file from project root if it exists (for NGROK_DOMAIN and other env vars)
-include ../.env
export

# Include deployment targets
include make.deploy

# XDG configuration directory and profile (v0.7.0)
XDG_CONFIG ?= $(HOME)/.config/benchling-webhook
PROFILE ?= dev
PROFILE_DIR = $(XDG_CONFIG)/$(PROFILE)

# Default log level
LOG_LEVEL ?= INFO

# Port configuration
PORT_NATIVE := 5001
PORT_DOCKER_DEV := 5002
PORT_DOCKER_PROD := 5003

# UV command with dev group (for linting and testing)
UVDEV = uv run --group dev

.PHONY: help build test clean install lint ngrok kill \
        check-xdg check-ngrok run-native run-native-verbose run-dev run run-native-ngrok run-ecr \
        test test-unit test-integration test-dev test-docker-dev test-docker-prod test-deployed-dev test-deployed-dev-direct test-deployed-prod test-ecr test-native test-benchling test-query \
        health-native health-dev health logs-dev logs

# Default target
help:
	@echo "Benchling Integration Service - Development Commands"
	@echo ""
	@echo "Setup:"
	@echo "  check-xdg             - Verify XDG config exists (~/.config/benchling-webhook/default/config.json)"
	@echo "  check-ngrok           - Verify ngrok is configured (auto-adds authtoken if needed)"
	@echo "  install               - Install dependencies with uv"
	@echo ""
	@echo "Development Servers (all use xdg-launch):"
	@echo "  run / run-dev         - Docker dev with hot-reload (port $(PORT_DOCKER_DEV))"
	@echo "  run-prod              - Docker production mode (port $(PORT_DOCKER_PROD))"
	@echo "  run-ngrok             - Docker dev + ngrok tunnel (requires NGROK_DOMAIN env var)"
	@echo "  run-native            - Native Flask with dev profile (port $(PORT_NATIVE))"
	@echo "  run-native-verbose    - Alias for run-native (always verbose)"
	@echo "  run-native-ngrok      - Native server + ngrok tunnel (requires NGROK_DOMAIN env var)"
	@echo "  run-ecr               - Pull and run image from ECR (port $(PORT_DOCKER_PROD))"
	@echo ""
	@echo "Testing (xdg-launch-based tests marked with *):"
	@echo "  test                  - Run all tests (unit + integration + docker)"
	@echo "  test-unit             - Run unit tests (pytest)"
	@echo "  test-native *         - Test native Flask (uses xdg-launch)"
	@echo "  test-dev              - Test webhooks against docker dev (port $(PORT_DOCKER_DEV))"
	@echo "  test-docker-dev *     - Test local docker dev (uses xdg-launch)"
	@echo "  test-docker-prod *    - Test local docker prod (uses xdg-launch)"
	@echo "  test-deployed-dev     - Test dev stack via API Gateway (auto-deploys if needed)"
	@echo "  test-deployed-prod    - Test prod stack via API Gateway endpoint"
	@echo "  test-ecr              - Test webhooks against ECR image (port $(PORT_DOCKER_PROD))"
	@echo "  test-benchling        - Test Benchling OAuth credentials"
	@echo "  test-query            - Test Quilt package query (defaults to BENCHLING_TEST_ENTRY)"
	@echo "  test-integration      - Full integration tests (requires real Benchling creds)"
	@echo "  lint                  - Auto-fix code formatting (black + isort) and type check (pyright)"
	@echo ""
	@echo "Health & Monitoring:"
	@echo "  health                - Check docker prod health (port $(PORT_DOCKER_PROD))"
	@echo "  health-native         - Check native server health (port $(PORT_NATIVE))"
	@echo "  health-dev            - Check docker dev health (port $(PORT_DOCKER_DEV))"
	@echo "  logs                  - Show docker prod logs"
	@echo "  logs-dev              - Show docker dev logs"
	@echo ""
	@echo "Deployment:"
	@echo "  build                 - Build Docker image (local development)"
	@echo "  deploy-help           - Show detailed deployment and Docker commands (see make.deploy)"
	@echo "  push-local            - Push with arch in image name (auto-creates ECR repo)"
	@echo "  push-ci               - Push with generic image name (auto-creates ECR repo)"
	@echo "  docker-build-local    - Build Docker image locally without pushing"
	@echo "  Add DRY_RUN=1 for dry run: make push-local DRY_RUN=1"
	@echo ""
	@echo "Infrastructure:"
	@echo "  ngrok                 - Expose server via ngrok (auto-cleanup, use PORT=5002 SLEEP=10)"
	@echo ""
	@echo "Maintenance:"
	@echo "  clean                 - Remove containers and images"
	@echo "  docker-clean          - Deep clean Docker (fixes run-dev issues)"
	@echo "  kill                  - Stop Docker containers and kill local processes"
	@echo ""
	@echo "Environment Variables (v0.7.0):"
	@echo "  PROFILE               - Configuration profile to use (default: dev)"
	@echo "  SKIP_AUTO_DEPLOY      - Skip auto-deployment in test-deployed-dev"
	@echo ""
	@echo "Examples:"
	@echo "  make test-native               - Test with dev profile (default)"
	@echo "  make test-native PROFILE=sales - Test with sales profile"
	@echo "  make run-native PROFILE=prod   - Run native server with prod profile"

# Setup

# Verify XDG config exists (v0.7.0: check for profile-based config)
check-xdg:
	@if [ ! -f $(PROFILE_DIR)/config.json ]; then \
		echo "❌ Profile '$(PROFILE)' config not found at $(PROFILE_DIR)/config.json"; \
		echo "   Run: npm run setup"; \
		exit 1; \
	fi

# Verify ngrok is configured (add authtoken if needed)
check-ngrok:
	@if ! ngrok config check >/dev/null 2>&1; then \
		if [ -z "$(NGROK_AUTHTOKEN)" ]; then \
			echo "Error: ngrok not configured and NGROK_AUTHTOKEN not set"; \
			echo "Get authtoken: https://dashboard.ngrok.com/get-started/your-authtoken"; \
			exit 1; \
		fi; \
		ngrok config add-authtoken $(NGROK_AUTHTOKEN); \
		echo "✅ Configured ngrok with authtoken"; \
	fi

# Install dependencies
install:
	uv sync --group dev

# Test Benchling OAuth credentials from AWS Secrets Manager
test-benchling: check-xdg
	uv run python scripts/test_benchling.py

# Test Quilt package query via Athena database
test-query: check-xdg
	uv run python scripts/test_query.py

# Run Servers

# Docker development server with hot-reload (uses xdg-launch via npm)
run: check-xdg
	@echo "Starting dev server with hot-reload..."
	@echo "💡 If you encounter issues, run 'make docker-clean' first"
	cd .. && npm run dev:docker

# Alias for run (for consistency with test-dev)
run-dev: run

run-ngrok:
	@if [ -z "$(NGROK_DOMAIN)" ]; then \
		echo "❌ Error: NGROK_DOMAIN environment variable is required"; \
		echo ""; \
		echo "Get your static domain from: https://dashboard.ngrok.com/domains"; \
		echo ""; \
		echo "Usage:"; \
		echo "  export NGROK_DOMAIN=uniformly-alive-halibut.ngrok-free.app"; \
		echo "  make run-ngrok"; \
		exit 1; \
	fi
	@echo "🚀 Starting dev server and ngrok tunnel..."
	@echo "📡 Public URL: https://$(NGROK_DOMAIN)/"
	@echo ""
	@make run &
	@make ngrok PORT=$(PORT_DOCKER_DEV) SLEEP=10

# Docker production server (uses xdg-launch via npm)
run-prod: check-xdg
	@echo "Starting production server..."
	cd .. && npm run dev:prod

# Native Flask server (uses xdg-launch via npm)
run-native: check-xdg
	cd .. && npm run launch -- --mode native --profile $(PROFILE) --verbose

# Native Flask server with verbose logging (alias for backward compatibility)
run-native-verbose: run-native

# Native server + ngrok tunnel
run-native-ngrok: check-xdg
	@if [ -z "$(NGROK_DOMAIN)" ]; then \
		echo "❌ Error: NGROK_DOMAIN environment variable is required"; \
		echo ""; \
		echo "Get your static domain from: https://dashboard.ngrok.com/domains"; \
		echo ""; \
		echo "Usage:"; \
		echo "  export NGROK_DOMAIN=uniformly-alive-halibut.ngrok-free.app"; \
		echo "  make run-native-ngrok"; \
		exit 1; \
	fi
	@echo "🚀 Starting native server and ngrok tunnel..."
	@echo "📡 Public URL: https://$(NGROK_DOMAIN)/"
	@echo ""
	@echo "Press Ctrl+C to stop both ngrok and server"
	@make run-native-verbose &
	@make ngrok PORT=$(PORT_NATIVE)

# Run ECR image locally (assumes image exists in ECR)
run-ecr: check-xdg docker-ecr-login
	@echo "Pulling latest image from ECR..."
	@AWS_ACCOUNT_ID=$$(aws sts get-caller-identity --query Account --output text 2>/dev/null) || \
		{ echo "❌ Failed to get AWS account ID - check AWS credentials"; exit 1; }; \
	ECR_IMAGE=$$AWS_ACCOUNT_ID.dkr.ecr.$(AWS_REGION).amazonaws.com/quiltdata/benchling-$(ARCH):latest; \
	echo "Image: $$ECR_IMAGE"; \
	docker pull $$ECR_IMAGE; \
	echo "Starting container from ECR image..."; \
	docker run -d --name benchling-ecr-test \
		-p $(PORT_DOCKER_PROD):5000 \
		-v ~/.aws:/home/appuser/.aws:ro \
		$$ECR_IMAGE; \
	echo "✅ Container started on port $(PORT_DOCKER_PROD)"; \
	echo "💡 Stop with: docker stop benchling-ecr-test && docker rm benchling-ecr-test"

# Testing

# Run standlaone tests
test: lint test-unit test-integration

# Run all tests (requires dev server)
test-all: lint test-unit test-dev test-integration

# Run unit tests with pytest
test-unit:
	$(UVDEV) pytest -v

# Run integration tests with execution monitoring (requires real Benchling credentials)
test-integration: test-benchling
	@echo "Stopping any running containers..."
	@docker-compose down 2>/dev/null || true
	@echo "Starting dev for integration tests..."
	@ENABLE_WEBHOOK_VERIFICATION=false docker-compose --profile dev up -d app-dev
	@if [ -z "$(BENCHLING_TEST_ENTRY)" ]; then \
		echo "Error: BENCHLING_TEST_ENTRY not set"; \
		echo "Set it in XDG config or as environment variable (e.g., BENCHLING_TEST_ENTRY=etr_fZ9XzOQV)"; \
		exit 1; \
	fi
	@echo "Running integration tests against http://localhost:$(PORT_DOCKER_DEV)..."
	@uv run python scripts/test_integration.py \
		--url http://localhost:$(PORT_DOCKER_DEV) \
		--entry-id $(BENCHLING_TEST_ENTRY) \
		--wait-for-health

# Test webhooks against native dev server (uses xdg-launch via npm)
# Uses dev profile by default, errors if profile doesn't exist
test-native: check-xdg kill
	@echo "Running native server tests (profile: $(PROFILE))..."
	cd .. && npm run test:native

# Test webhooks against docker dev server (requires server running)
test-dev:
	@if ! curl -s http://localhost:$(PORT_DOCKER_DEV)/health >/dev/null 2>&1; then \
		echo "❌ Dev server not running on port $(PORT_DOCKER_DEV)"; \
		echo "Start it first with: make run-dev (or make run)"; \
		exit 1; \
	fi
	@echo "Testing webhooks against http://localhost:$(PORT_DOCKER_DEV)"
	uv run python scripts/test_webhook.py http://localhost:$(PORT_DOCKER_DEV)

# Test webhooks against local docker dev container (uses xdg-launch via npm)
test-docker-dev: check-xdg
	@echo "Running local docker dev tests (profile: $(PROFILE))..."
	cd .. && npm run test:local

# Test webhooks against local docker production container (uses xdg-launch via npm)
test-docker-prod: check-xdg
	@echo "Running local docker prod tests (profile: $(PROFILE))..."
	cd .. && npm run test:local:prod

# Test ECR image (auto-starts, tests, and cleans up)
test-ecr: check-xdg
	@echo "🧹 Cleaning up any existing ECR test container..."
	@docker stop benchling-ecr-test 2>/dev/null || true
	@docker rm benchling-ecr-test 2>/dev/null || true
	@echo "📦 Starting fresh ECR container..."
	@$(MAKE) run-ecr
	@sleep 5
	@echo "Waiting for ECR container to be healthy..."
	@for i in 1 2 3 4 5 6 7 8 9 10; do \
		if curl -s http://localhost:$(PORT_DOCKER_PROD)/health >/dev/null 2>&1; then \
			echo "✅ Container is healthy"; \
			break; \
		fi; \
		echo "Waiting for health check ($$i/10)..."; \
		sleep 3; \
	done
	@echo "Running tests against ECR image at http://localhost:$(PORT_DOCKER_PROD)"
	@uv run python scripts/test_webhook.py http://localhost:$(PORT_DOCKER_PROD) || \
		(echo "❌ Tests failed, cleaning up..."; docker stop benchling-ecr-test; docker rm benchling-ecr-test; exit 1)
	@echo "✅ Tests passed, cleaning up..."
	@docker stop benchling-ecr-test
	@docker rm benchling-ecr-test
	@echo "✅ Done"

# Test deployed dev stack via API Gateway endpoint (auto-deploys if needed)
# v0.7.0: Updated to use deployments.json with profile/stage structure
test-deployed-dev: check-xdg
	@if [ -n "$(SKIP_AUTO_DEPLOY)" ]; then \
		echo "⏭️  Auto-deploy disabled (SKIP_AUTO_DEPLOY=1)"; \
		$(MAKE) -C $(CURDIR) test-deployed-dev-direct; \
	else \
		echo "🔍 Checking if dev deployment is needed..."; \
		DEPLOYMENTS_JSON=$(PROFILE_DIR)/deployments.json; \
		NEEDS_DEPLOY=0; \
		if [ ! -f "$$DEPLOYMENTS_JSON" ]; then \
			echo "📦 No deployments.json found - deployment needed"; \
			NEEDS_DEPLOY=1; \
		elif ! jq -e '.active.dev' "$$DEPLOYMENTS_JSON" >/dev/null 2>&1; then \
			echo "📦 No dev deployment found - deployment needed"; \
			NEEDS_DEPLOY=1; \
		else \
			DEPLOYED_AT=$$(jq -r '.active.dev.timestamp // empty' "$$DEPLOYMENTS_JSON"); \
			if [ -z "$$DEPLOYED_AT" ]; then \
				echo "📦 No deployment timestamp found - deployment needed"; \
				NEEDS_DEPLOY=1; \
			else \
				if [ "$$(uname)" = "Darwin" ]; then \
					DEPLOYED_EPOCH=$$(date -j -f "%Y-%m-%dT%H:%M:%S" "$${DEPLOYED_AT%.*}" +%s 2>/dev/null || echo 0); \
					NEWEST_PY=$$(find . -path ./docker -prune -o -name "*.py" -type f -exec stat -f %m {} \; 2>/dev/null | sort -rn | head -1); \
				else \
					DEPLOYED_EPOCH=$$(date -d "$${DEPLOYED_AT%.*}" +%s 2>/dev/null || echo 0); \
					NEWEST_PY=$$(find . -path ./docker -prune -o -name "*.py" -type f -exec stat -c %Y {} \; 2>/dev/null | sort -rn | head -1); \
				fi; \
				if [ -n "$$NEWEST_PY" ] && [ "$$NEWEST_PY" -gt "$$DEPLOYED_EPOCH" ]; then \
					echo "📦 Python sources newer than deployment - deployment needed"; \
					NEEDS_DEPLOY=1; \
				fi; \
			fi; \
		fi; \
		if [ "$$NEEDS_DEPLOY" = "1" ]; then \
			echo "🚀 Auto-deploying dev stack..."; \
			echo "   (Set SKIP_AUTO_DEPLOY=1 to disable auto-deployment)"; \
			cd .. && npm run deploy:dev -- $(DEPLOY_FLAGS) || exit 1; \
		else \
			echo "✅ Dev deployment is up-to-date"; \
		fi; \
		$(MAKE) -C $(CURDIR) test-deployed-dev-direct; \
	fi

# Test deployed dev stack (direct, no auto-deploy check)
# v0.7.0: Updated to use deployments.json with profile/stage structure
test-deployed-dev-direct: check-xdg
	@echo "🧪 Testing deployed dev stack (profile: $(PROFILE))..."
	@DEV_ENDPOINT=$$(jq -r '.active.dev.endpoint // empty' $(PROFILE_DIR)/deployments.json 2>/dev/null); \
	IMAGE_TAG=$$(jq -r '.active.dev.imageTag // empty' $(PROFILE_DIR)/deployments.json 2>/dev/null); \
	DEPLOYED_AT=$$(jq -r '.active.dev.timestamp // empty' $(PROFILE_DIR)/deployments.json 2>/dev/null); \
	if [ -z "$$DEV_ENDPOINT" ]; then \
		echo "❌ No dev endpoint found in $(PROFILE_DIR)/deployments.json"; \
		echo "💡 Run 'npm run deploy:dev -- --profile $(PROFILE)' first to deploy the dev stack"; \
		exit 1; \
	fi; \
	echo "📡 Testing endpoint: $$DEV_ENDPOINT"; \
	if [ -n "$$IMAGE_TAG" ]; then \
		echo "🐳 Image tag: $$IMAGE_TAG"; \
	fi; \
	if [ -n "$$DEPLOYED_AT" ]; then \
		echo "📅 Deployed at: $$DEPLOYED_AT"; \
	fi; \
	uv run python scripts/test_webhook.py "$$DEV_ENDPOINT" --health-only

# Test deployed prod stack via API Gateway endpoint
# v0.7.0: Updated to use deployments.json with profile/stage structure
test-deployed-prod: check-xdg
	@echo "🧪 Testing deployed prod stack (profile: $(PROFILE))..."
	@PROD_ENDPOINT=$$(jq -r '.active.prod.endpoint // empty' $(PROFILE_DIR)/deployments.json 2>/dev/null); \
	IMAGE_TAG=$$(jq -r '.active.prod.imageTag // empty' $(PROFILE_DIR)/deployments.json 2>/dev/null); \
	DEPLOYED_AT=$$(jq -r '.active.prod.timestamp // empty' $(PROFILE_DIR)/deployments.json 2>/dev/null); \
	if [ -z "$$PROD_ENDPOINT" ]; then \
		echo "❌ No prod endpoint found in $(PROFILE_DIR)/deployments.json"; \
		echo "💡 Run 'npm run deploy:prod -- --profile $(PROFILE)' first to deploy the prod stack"; \
		exit 1; \
	fi; \
	echo "📡 Testing endpoint: $$PROD_ENDPOINT"; \
	if [ -n "$$IMAGE_TAG" ]; then \
		echo "🐳 Image tag: $$IMAGE_TAG"; \
	fi; \
	if [ -n "$$DEPLOYED_AT" ]; then \
		echo "📅 Deployed at: $$DEPLOYED_AT"; \
	fi; \
	uv run python scripts/test_webhook.py "$$PROD_ENDPOINT" --health-only

# Auto-fix code formatting (black + isort) and type check (pyright)
lint:
	$(UVDEV) black src/ tests/ scripts/
	$(UVDEV) isort src/ tests/ scripts/
	$(UVDEV) pyright src/ tests/ scripts/

# Deployment

# Build Docker image (local development)
build:
	docker build -t benchling-webhook .

# Health & Monitoring

# Check docker prod health - DEFAULT
health-prod:
	@echo "Checking docker prod health..."
	@curl -s http://localhost:$(PORT_DOCKER_PROD)/health | jq .
	@echo "\nChecking readiness..."
	@curl -s http://localhost:$(PORT_DOCKER_PROD)/health/ready | jq .

# Check native server health
health-native:
	@echo "Checking native server health..."
	@curl -s http://localhost:$(PORT_NATIVE)/health | jq .
	@echo "\nChecking readiness..."
	@curl -s http://localhost:$(PORT_NATIVE)/health/ready | jq .

# Check docker dev health
health-dev:
	@echo "Checking docker dev health..."
	@curl -s http://localhost:$(PORT_DOCKER_DEV)/health | jq .
	@echo "\nChecking readiness..."
	@curl -s http://localhost:$(PORT_DOCKER_DEV)/health/ready | jq .

# Show docker prod logs - DEFAULT
logs-prod:
	docker-compose logs -f app

# Show docker dev logs
logs-dev:
	docker-compose logs -f app-dev

logs: logs-dev logs-prod

# Infrastructure

# Expose any port via ngrok (defaults to PORT_DOCKER_DEV if PORT not specified)
# Usage: make ngrok [PORT=5002] [SLEEP=5]
ngrok: check-ngrok
	@SLEEP_TIME=$${SLEEP:-3}; \
	echo "Waiting $$SLEEP_TIME seconds for server to start..."; \
	sleep $$SLEEP_TIME; \
	PORT=$${PORT:-$(PORT_DOCKER_DEV)}; \
	if [ -n "$(NGROK_DOMAIN)" ]; then \
		echo "Starting ngrok on port $$PORT with domain $(NGROK_DOMAIN)..."; \
		ngrok http $$PORT --domain=$(NGROK_DOMAIN); \
	else \
		echo "Starting ngrok on port $$PORT..."; \
		ngrok http $$PORT; \
	fi; \
	make kill

# Maintenance

# Smart kill: stop Docker containers and kill native Python processes
kill:
	@echo "Stopping servers..."
	@pkill -f "python scripts/run_native.py" 2>/dev/null && echo "✅ Killed native Flask server" || echo "ℹ️  No native Flask server running"
	@docker-compose --profile dev down 2>/dev/null && echo "✅ Stopped Docker containers" || echo "ℹ️  No Docker containers running"
	@echo "✅ Done"

# Clean up containers and images
clean:
	docker-compose down
	docker rmi benchling-webhook || true
	docker system prune -f

# Deep clean Docker resources (fixes run-dev issues)
docker-clean:
	@echo "🧹 Performing deep Docker cleanup..."
	@echo "Stopping all containers..."
	docker-compose --profile dev down -v
	docker-compose down -v
	@echo "Removing benchling-webhook images..."
	docker rmi benchling-webhook || true
	docker rmi $$(docker images -q benchling-webhook) 2>/dev/null || true
	@echo "Pruning Docker system (containers, networks, build cache)..."
	docker system prune -af --volumes
	@echo "✅ Docker cleanup complete. You can now run 'make run-dev'"
