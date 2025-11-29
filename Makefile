# Makefile for Benchling Webhook Lambda Authorizer
# Manages Python dependency bundling for AWS Lambda deployment

.PHONY: all clean lambda-bundle check-bundle help

# Default target
all: lambda-bundle

# Lambda authorizer bundle target
# Dependencies: source code, requirements, constraints
LAMBDA_SRC := docker/src/lambda_authorizer.py
LAMBDA_REQUIREMENTS := lambda/authorizer/requirements.txt
LAMBDA_CONSTRAINTS := lambda/authorizer/constraints.txt
LAMBDA_BUNDLE_DIR := lambda/authorizer/wheelhouse
LAMBDA_BUNDLE_MARKER := $(LAMBDA_BUNDLE_DIR)/.bundle-timestamp

# Build lambda bundle when source or dependencies change
$(LAMBDA_BUNDLE_MARKER): $(LAMBDA_SRC) $(LAMBDA_REQUIREMENTS) $(LAMBDA_CONSTRAINTS)
	@echo "==> Building Lambda authorizer bundle..."
	@echo "    Source: $(LAMBDA_SRC)"
	@echo "    Requirements: $(LAMBDA_REQUIREMENTS)"
	@echo "    Constraints: $(LAMBDA_CONSTRAINTS)"
	@echo ""
	@mkdir -p $(LAMBDA_BUNDLE_DIR)
	@# Download wheels for x86_64 Linux (Lambda runtime)
	pip download \
		--platform manylinux2014_x86_64 \
		--implementation cp \
		--python-version 3.12 \
		--abi cp312 \
		--only-binary=:all: \
		--dest $(LAMBDA_BUNDLE_DIR) \
		--requirement $(LAMBDA_REQUIREMENTS) \
		--constraint $(LAMBDA_CONSTRAINTS)
	@# Create marker file with build timestamp
	@touch $(LAMBDA_BUNDLE_MARKER)
	@echo "==> Lambda bundle built successfully"
	@echo "    Bundle directory: $(LAMBDA_BUNDLE_DIR)"
	@echo "    Timestamp: $$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	@echo ""

# Primary build target
lambda-bundle: $(LAMBDA_BUNDLE_MARKER)

# Check if bundle exists and is up-to-date
check-bundle:
	@if [ ! -f "$(LAMBDA_BUNDLE_MARKER)" ]; then \
		echo "❌ Lambda bundle does not exist"; \
		echo "   Run: make lambda-bundle"; \
		exit 1; \
	fi
	@if [ "$(LAMBDA_SRC)" -nt "$(LAMBDA_BUNDLE_MARKER)" ] || \
	    [ "$(LAMBDA_REQUIREMENTS)" -nt "$(LAMBDA_BUNDLE_MARKER)" ] || \
	    [ "$(LAMBDA_CONSTRAINTS)" -nt "$(LAMBDA_BUNDLE_MARKER)" ]; then \
		echo "⚠️  Lambda bundle is stale (source files newer than bundle)"; \
		echo "   Source: $(LAMBDA_SRC)"; \
		echo "   Requirements: $(LAMBDA_REQUIREMENTS)"; \
		echo "   Bundle marker: $(LAMBDA_BUNDLE_MARKER)"; \
		echo "   Run: make lambda-bundle"; \
		exit 1; \
	fi
	@echo "✅ Lambda bundle is up-to-date"
	@echo "   Bundle directory: $(LAMBDA_BUNDLE_DIR)"
	@echo "   Last built: $$(stat -f '%Sm' -t '%Y-%m-%d %H:%M:%S' $(LAMBDA_BUNDLE_MARKER) 2>/dev/null || stat -c '%y' $(LAMBDA_BUNDLE_MARKER) 2>/dev/null)"

# Clean build artifacts
clean:
	@echo "==> Cleaning Lambda authorizer bundle..."
	@rm -rf $(LAMBDA_BUNDLE_DIR)
	@echo "    Removed: $(LAMBDA_BUNDLE_DIR)"
	@echo "✅ Clean complete"

# Help target
help:
	@echo "Benchling Webhook Lambda Authorizer Build"
	@echo ""
	@echo "Targets:"
	@echo "  make lambda-bundle   - Build Lambda authorizer bundle (downloads Python wheels)"
	@echo "  make check-bundle    - Verify bundle exists and is up-to-date"
	@echo "  make clean           - Remove build artifacts"
	@echo "  make help            - Show this help message"
	@echo ""
	@echo "Files:"
	@echo "  Source:       $(LAMBDA_SRC)"
	@echo "  Requirements: $(LAMBDA_REQUIREMENTS)"
	@echo "  Constraints:  $(LAMBDA_CONSTRAINTS)"
	@echo "  Bundle:       $(LAMBDA_BUNDLE_DIR)"
