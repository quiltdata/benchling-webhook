#!/bin/bash

# Script to create a new release with proper tagging and documentation
# Usage: ./bin/create-release.sh [version]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Get version from package.json if not provided
if [ -z "$1" ]; then
    VERSION=$(node -e "console.log(require('$PROJECT_ROOT/package.json').version)")
else
    VERSION="$1"
fi

echo "========================================="
echo "Creating Release v$VERSION"
echo "========================================="
echo ""

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "Error: Not in a git repository"
    exit 1
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo "Error: You have uncommitted changes"
    echo "Please commit or stash your changes before creating a release"
    exit 1
fi

# Ensure we're on main branch for releases
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "Warning: You are on branch '$CURRENT_BRANCH', not 'main'"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check if tag already exists
if git rev-parse "v$VERSION" >/dev/null 2>&1; then
    echo "Error: Tag v$VERSION already exists"
    echo "Use a different version or delete the existing tag"
    exit 1
fi

# Get account and region from environment or AWS
if [ -f "$PROJECT_ROOT/.env" ]; then
    source "$PROJECT_ROOT/.env"
fi

CDK_DEFAULT_ACCOUNT=${CDK_DEFAULT_ACCOUNT:-$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "UNKNOWN")}
CDK_DEFAULT_REGION=${CDK_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || echo "us-east-1")}

# Docker image information
DOCKER_IMAGE_URI="$CDK_DEFAULT_ACCOUNT.dkr.ecr.$CDK_DEFAULT_REGION.amazonaws.com/quiltdata/benchling:$VERSION"
DOCKER_IMAGE_LATEST="$CDK_DEFAULT_ACCOUNT.dkr.ecr.$CDK_DEFAULT_REGION.amazonaws.com/quiltdata/benchling:latest"

echo "Release Details:"
echo "  Version: v$VERSION"
echo "  Docker Image: $DOCKER_IMAGE_URI"
echo "  Also tagged as: latest"
echo "  Region: $CDK_DEFAULT_REGION"
echo "  Account: $CDK_DEFAULT_ACCOUNT"
echo ""

# Check if Docker image exists
echo "Checking if Docker image exists in ECR..."
if aws ecr describe-images \
    --repository-name quiltdata/benchling \
    --image-ids imageTag="$VERSION" \
    --region "$CDK_DEFAULT_REGION" \
    >/dev/null 2>&1; then
    echo "✓ Docker image found in ECR"
else
    echo "⚠ Warning: Docker image v$VERSION not found in ECR"
    echo ""
    read -p "Do you want to build and push the image now? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Building and pushing Docker image..."
        cd "$PROJECT_ROOT"
        npm run docker-push
        echo "✓ Docker image built and pushed"
    else
        echo "Skipping Docker image build"
    fi
fi
echo ""

# Create release notes entry
RELEASE_DATE=$(date +"%Y-%m-%d")
RELEASE_NOTES_ENTRY="
### v$VERSION ($RELEASE_DATE)
- Docker Image: \`$DOCKER_IMAGE_URI\`
- Architecture: linux/amd64
- Changes:
  - [Add your changes here]

"

echo "Updating RELEASE_NOTES.md..."
# Add entry to release history section
if [ -f "$PROJECT_ROOT/RELEASE_NOTES.md" ]; then
    # Create a backup
    cp "$PROJECT_ROOT/RELEASE_NOTES.md" "$PROJECT_ROOT/RELEASE_NOTES.md.bak"

    # Update current release section
    sed -i.tmp "s/## Current Release: .*/## Current Release: v$VERSION/" "$PROJECT_ROOT/RELEASE_NOTES.md"

    # Update version in Docker Image section
    sed -i.tmp "s|- **Tags**: .*|- **Tags**: \`$VERSION\`, \`latest\`|" "$PROJECT_ROOT/RELEASE_NOTES.md"
    sed -i.tmp "s|- **Build Date**: .*|- **Build Date**: $RELEASE_DATE|" "$PROJECT_ROOT/RELEASE_NOTES.md"

    rm -f "$PROJECT_ROOT/RELEASE_NOTES.md.tmp"
    echo "✓ RELEASE_NOTES.md updated"
else
    echo "⚠ Warning: RELEASE_NOTES.md not found"
fi
echo ""

# Create git tag
echo "Creating git tag..."
TAG_MESSAGE="Release v$VERSION

Docker Image: $DOCKER_IMAGE_URI
Region: $CDK_DEFAULT_REGION
Date: $RELEASE_DATE

To deploy this release:
  npm install
  npm run deploy

To use this Docker image:
  docker pull $DOCKER_IMAGE_URI
"

git tag -a "v$VERSION" -m "$TAG_MESSAGE"
echo "✓ Git tag v$VERSION created"
echo ""

# Summary
echo "========================================="
echo "Release v$VERSION Created Successfully!"
echo "========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Review the changes:"
echo "   git show v$VERSION"
echo ""
echo "2. Push the tag to trigger CI/CD release workflow:"
echo "   git push origin v$VERSION"
echo ""
echo "   This will automatically:"
echo "   - Build and test the package"
echo "   - Build and push Docker image to ECR"
echo "   - Create GitHub Release with release notes"
echo "   - Publish package to NPM (if configured)"
echo "   - Publish package to GitHub Packages"
echo ""
echo "3. Verify Docker image:"
echo "   npm run docker-check"
echo ""
echo "4. Monitor the release workflow:"
echo "   https://github.com/quiltdata/benchling-webhook/actions"
echo ""
echo "5. Update RELEASE_NOTES.md with detailed changes (optional)"
echo ""
echo "To undo (before pushing):"
echo "   git tag -d v$VERSION"
echo ""
echo "Docker Image Information:"
echo "  URI: $DOCKER_IMAGE_URI"
echo "  Latest: $DOCKER_IMAGE_LATEST"
echo ""
echo "Package Information:"
echo "  NPM: quilt-benchling-webhook@$VERSION"
echo "  GitHub: @quiltdata/quilt-benchling-webhook@$VERSION"
echo ""
echo "========================================="
