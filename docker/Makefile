# Benchling-Quilt Integration Makefile

# Configuration is now managed via XDG (~/.config/benchling-webhook/default.json)
# and AWS Secrets Manager instead of .env files

# Include deployment targets
include make.deploy

# Default log level
LOG_LEVEL ?= INFO

# Port configuration
PORT_LOCAL := 5001
PORT_DOCKER_DEV := 5002
PORT_DOCKER_PROD := 5003

.PHONY: help build test clean install lint ngrok kill \
        check-xdg check-ngrok run-local run-local-verbose run-dev run run-local-ngrok run-ecr \
        test test-unit test-integration test-dev test-docker-prod test-deployed-dev test-deployed-prod test-ecr test-local test-benchling test-query \
        health-local health-dev health logs-dev logs

# Default target
help:
	@echo "Benchling Integration Service - Development Commands"
	@echo ""
	@echo "Setup:"
	@echo "  check-xdg             - Verify XDG config exists (~/.config/benchling-webhook/default.json)"
	@echo "  check-ngrok           - Verify ngrok is configured (auto-adds authtoken if needed)"
	@echo "  install               - Install dependencies with uv"
	@echo ""
	@echo "Development Servers:"
	@echo "  run / run-dev         - Docker dev with hot-reload (needs AWS, port $(PORT_DOCKER_DEV))"
	@echo "  run-ngrok             - Docker dev + ngrok tunnel (port $(PORT_DOCKER_DEV))"
	@echo "  run-local             - Local Flask with mocked AWS (port $(PORT_LOCAL))"
	@echo "  run-local-verbose     - Local Flask with debug logging (port $(PORT_LOCAL))"
	@echo "  run-local-ngrok       - Local server + ngrok tunnel (port $(PORT_LOCAL))"
	@echo "  run-ecr               - Pull and run image from ECR (port $(PORT_DOCKER_PROD))"
	@echo ""
	@echo "Testing:"
	@echo "  test                  - Run all tests (unit + integration + docker)"
	@echo "  test-unit             - Run unit tests (pytest)"
	@echo "  test-local            - Test webhooks with auto-managed local server"
	@echo "  test-dev              - Test webhooks against docker dev (port $(PORT_DOCKER_DEV))"
	@echo "  test-docker-prod      - Test local docker prod container (port $(PORT_DOCKER_PROD))"
	@echo "  test-deployed-dev     - Test dev stack via API Gateway endpoint"
	@echo "  test-deployed-prod    - Test prod stack via API Gateway endpoint"
	@echo "  test-ecr              - Test webhooks against ECR image (port $(PORT_DOCKER_PROD))"
	@echo "  test-benchling        - Test Benchling OAuth credentials"
	@echo "  test-query            - Test Quilt package query (defaults to BENCHLING_TEST_ENTRY)"
	@echo "  test-integration      - Full integration tests (requires real Benchling creds)"
	@echo "  lint                  - Auto-fix code formatting"
	@echo ""
	@echo "Health & Monitoring:"
	@echo "  health                - Check docker prod health (port $(PORT_DOCKER_PROD))"
	@echo "  health-local          - Check local server health (port $(PORT_LOCAL))"
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

# ==============================================================================
# Setup
# ==============================================================================

# Verify XDG config exists
check-xdg:
	@if [ ! -f ~/.config/benchling-webhook/default.json ]; then \
		echo "❌ XDG config not found. Run: npm run setup"; \
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
	uv sync --all-extras

# Test Benchling OAuth credentials from AWS Secrets Manager
test-benchling: check-xdg
	uv run python scripts/test_benchling.py

# Test Quilt package query via Athena database
test-query: check-xdg
	uv run python scripts/test_query.py

# ==============================================================================
# Run Servers
# ==============================================================================

# Docker development server with hot-reload (requires AWS credentials)
run: build check-xdg
	@echo "Starting dev server with hot-reload..."
	@echo "💡 If you encounter issues, run 'make docker-clean' first"
	docker-compose --profile dev up app-dev

# Alias for run (for consistency with test-dev)
run-dev: run

run-ngrok:
	@make run &
	@make ngrok PORT=$(PORT_DOCKER_DEV) SLEEP=10

# Docker production server (requires AWS credentials) - DEFAULT
run-prod: build check-xdg
	docker-compose up -d
	@echo "Waiting for application to start..."
	@sleep 10
	@make health-prod

# Local Flask server with mocked AWS (no credentials needed)
run-local: check-xdg
	uv run python scripts/run_local.py

# Local Flask server with verbose logging
run-local-verbose: check-xdg
	uv run python scripts/run_local.py --verbose

# Local server + ngrok tunnel
run-local-ngrok: check-xdg
	@echo "Starting local server and ngrok tunnel..."
	@echo "Press Ctrl+C to stop both ngrok and server"
	@make run-local-verbose &
	@make ngrok

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

# ==============================================================================
# Testing
# ==============================================================================

# Run standlaone tests
test: lint test-unit test-integration

# Run all tests (requires dev server)
test-all: lint test-unit test-dev test-integration

# Run unit tests with pytest
test-unit:
	uv run pytest -v

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

# Test webhooks against local dev server (auto-starts and stops server)
test-local: check-xdg health-local
	@echo "Running local server tests (auto-start/stop)..."
	uv run python scripts/run_local.py --test

# Test webhooks against docker dev server (requires server running)
test-dev:
	@if ! curl -s http://localhost:$(PORT_DOCKER_DEV)/health >/dev/null 2>&1; then \
		echo "❌ Dev server not running on port $(PORT_DOCKER_DEV)"; \
		echo "Start it first with: make run-dev (or make run)"; \
		exit 1; \
	fi
	@echo "Testing webhooks against http://localhost:$(PORT_DOCKER_DEV)"
	uv run python scripts/test_webhook.py http://localhost:$(PORT_DOCKER_DEV)

# Test webhooks against local docker production container (auto-starts if not running)
test-docker-prod: run-prod health-prod
	@echo "Running webhook tests against http://localhost:$(PORT_DOCKER_PROD)"
	uv run python scripts/test_webhook.py http://localhost:$(PORT_DOCKER_PROD)

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

# Test deployed dev stack via API Gateway endpoint
test-deployed-dev: check-xdg
	@echo "🧪 Testing deployed dev stack..."
	@DEV_ENDPOINT=$$(jq -r '.dev.endpoint // empty' $(XDG_CONFIG)/deploy.json 2>/dev/null); \
	if [ -z "$$DEV_ENDPOINT" ]; then \
		echo "❌ No dev endpoint found in $(XDG_CONFIG)/deploy.json"; \
		echo "💡 Run 'npm run deploy:dev' first to deploy the dev stack"; \
		exit 1; \
	fi; \
	echo "📡 Testing endpoint: $$DEV_ENDPOINT"; \
	uv run python scripts/test_webhook.py "$$DEV_ENDPOINT"

# Test deployed prod stack via API Gateway endpoint
test-deployed-prod: check-xdg
	@echo "🧪 Testing deployed prod stack..."
	@PROD_ENDPOINT=$$(jq -r '.prod.endpoint // empty' $(XDG_CONFIG)/deploy.json 2>/dev/null); \
	if [ -z "$$PROD_ENDPOINT" ]; then \
		echo "❌ No prod endpoint found in $(XDG_CONFIG)/deploy.json"; \
		echo "💡 Run 'npm run deploy:prod' first to deploy the prod stack"; \
		exit 1; \
	fi; \
	echo "📡 Testing endpoint: $$PROD_ENDPOINT"; \
	uv run python scripts/test_webhook.py "$$PROD_ENDPOINT"

# Auto-fix code formatting (black + isort)
lint:
	uv run black src/ tests/ scripts/
	uv run isort src/ tests/ scripts/

# ==============================================================================
# Deployment
# ==============================================================================

# Build Docker image (local development)
build:
	docker build -t benchling-webhook .

# ==============================================================================
# Health & Monitoring
# ==============================================================================

# Check docker prod health - DEFAULT
health-prod:
	@echo "Checking docker prod health..."
	@curl -s http://localhost:$(PORT_DOCKER_PROD)/health | jq .
	@echo "\nChecking readiness..."
	@curl -s http://localhost:$(PORT_DOCKER_PROD)/health/ready | jq .

# Check local server health
health-local:
	@echo "Checking local server health..."
	@curl -s http://localhost:$(PORT_LOCAL)/health | jq .
	@echo "\nChecking readiness..."
	@curl -s http://localhost:$(PORT_LOCAL)/health/ready | jq .

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

# ==============================================================================
# Infrastructure
# ==============================================================================

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

# ==============================================================================
# Maintenance
# ==============================================================================

# Smart kill: stop Docker containers and kill local Python processes
kill:
	@echo "Stopping servers..."
	@pkill -f "python scripts/run_local.py" 2>/dev/null && echo "✅ Killed local Flask server" || echo "ℹ️  No local Flask server running"
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

