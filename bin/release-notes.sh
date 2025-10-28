#!/bin/bash
# Generate release notes for GitHub releases
# Usage: ./bin/release-notes.sh VERSION IMAGE_URI [IS_PRERELEASE]

set -e

VERSION="${1}"
IMAGE_URI="${2}"
IS_PRERELEASE="${3:-false}"

if [ -z "$VERSION" ] || [ -z "$IMAGE_URI" ]; then
  echo "Usage: $0 VERSION IMAGE_URI [IS_PRERELEASE]"
  echo "Example: $0 0.4.12 123456.dkr.ecr.us-west-2.amazonaws.com/quiltdata/benchling:0.4.12 false"
  exit 1
fi

# Extract changelog notes if available
CHANGELOG_NOTES=""
if [ -f CHANGELOG.md ]; then
  CHANGELOG_NOTES=$(sed -n "/## \[$VERSION\]/,/## \[/p" CHANGELOG.md | sed '$d' | sed '1d')
fi

# Generate release notes
cat << EOFNOTES
## Quick Start

# 1. Configure
cp env.template .env
# Edit .env with AWS account, Benchling credentials, S3/SQS settings

# 2. Install app-manifest.yaml as a Benchling app

# 3. Deploy
source .env
npx cdk bootstrap aws://\$CDK_DEFAULT_ACCOUNT/\$CDK_DEFAULT_REGION
npm run check

# 4. Set Benchling webhook URL in the app overview page

\`\`\`

## Docker Image

\`\`\`
${IMAGE_URI}
\`\`\`

Pull and run:
\`\`\`bash
docker pull ${IMAGE_URI}
\`\`\`

EOFNOTES

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
- [Release Process](https://github.com/quiltdata/benchling-webhook/blob/main/doc/RELEASE.md)
EOFRESOURCES
