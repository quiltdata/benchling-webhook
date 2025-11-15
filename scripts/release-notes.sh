#!/bin/bash
# Generate release notes for GitHub releases
# Usage: ./bin/release-notes.sh VERSION IMAGE_URI [IS_PRERELEASE] [PACKAGE_NAME]

set -e

VERSION="${1}"
IMAGE_URI="${2}"
IS_PRERELEASE="${3:-false}"
PACKAGE_NAME="${4:-@quiltdata/benchling-webhook}"

if [ -z "$VERSION" ] || [ -z "$IMAGE_URI" ]; then
  echo "Usage: $0 VERSION IMAGE_URI [IS_PRERELEASE] [PACKAGE_NAME]"
  echo "Example: $0 0.4.12 123456.dkr.ecr.us-west-2.amazonaws.com/quiltdata/benchling:0.4.12 false @quiltdata/benchling-webhook"
  exit 1
fi

# Extract changelog notes if available
CHANGELOG_NOTES=""
if [ -f CHANGELOG.md ]; then
  CHANGELOG_NOTES=$(sed -n "/## \[$VERSION\]/,/## \[/p" CHANGELOG.md | sed '$d' | sed '1d' | \
    grep -v "^- fix" | \
    grep -v "^- chore")
fi

# Generate release notes - insert README content
cat README.md

# Add package and Docker image information
# Convert package name for URLs (replace @ with %40, / with %2F)
PACKAGE_URL=$(echo "$PACKAGE_NAME" | sed 's/@/%40/g' | sed 's/\//%2F/g')

cat << EOFPACKAGES

## NPM Package

\`\`\`bash
npm install ${PACKAGE_NAME}@${VERSION}
\`\`\`

**View on npmjs.com:** [${PACKAGE_NAME}@${VERSION}](https://www.npmjs.com/package/${PACKAGE_URL}/v/${VERSION})

## Docker Image

For custom deployments, use the following Docker image:

\`\`\`
${IMAGE_URI}
\`\`\`

Pull and run:
\`\`\`bash
docker pull ${IMAGE_URI}
\`\`\`

EOFPACKAGES

# Add changelog notes if available
if [ -n "$CHANGELOG_NOTES" ]; then
  echo ""
  echo "## Changes"
  echo ""
  echo "$CHANGELOG_NOTES"
fi

# Add resources
cat << EOFRESOURCES

## Resources

- [Installation Guide](https://github.com/quiltdata/benchling-webhook#installation)
- [Configuration Guide](https://github.com/quiltdata/benchling-webhook#configuration)
- [Development Guide](https://github.com/quiltdata/benchling-webhook/tree/main/docker)
- [Release Process](https://github.com/quiltdata/benchling-webhook/blob/main/docs/RELEASE.md)
EOFRESOURCES
