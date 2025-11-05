# Smart test:dev Auto-Deployment

## Problem Statement

Currently, `npm run test:dev` fails when no dev stack is deployed:

```bash
$ npm run test:dev
> make -C docker test-deployed-dev

🧪 Testing deployed dev stack...
❌ No dev endpoint found in /deploy.json
💡 Run 'npm run deploy:dev' first to deploy the dev stack
make: *** [test-deployed-dev] Error 1
```

Users must manually run `npm run deploy:dev` first, even when:
1. No dev deployment exists
2. Python source files have changed since last deployment
3. Docker configuration has changed

This creates friction in the development workflow and can lead to testing against stale deployments.

## Requirements

### Functional Requirements

1. **Auto-detect deployment necessity**
   - Check if `~/.config/benchling-webhook/deploy.json` has a `dev` section
   - Compare timestamps between Python source and last deployment
   - Trigger deployment if:
     - No `deploy.json` exists
     - No `dev` section in `deploy.json`
     - Any Python source file in `docker/` is newer than `deployedAt` timestamp

2. **Leverage existing infrastructure**
   - Use `docker/Makefile` targets for deployment logic
   - Reuse `npm run deploy:dev` workflow
   - Maintain XDG config pattern

3. **User control**
   - Add `SKIP_AUTO_DEPLOY=1` environment variable to disable auto-deployment
   - Provide clear console output explaining what's happening
   - Fail fast if auto-deployment encounters errors

4. **Idempotency**
   - Safe to run multiple times
   - Skip deployment if nothing changed
   - No side effects from checking conditions

### Non-Functional Requirements

1. **Performance**
   - File timestamp check should be fast (< 1 second)
   - Only deploy when necessary
   - Use efficient file system operations

2. **Reliability**
   - Clear error messages if deployment fails
   - Preserve existing `deploy.json` structure
   - Handle missing directories gracefully

3. **Maintainability**
   - Reuse existing deployment scripts
   - Minimal code duplication
   - Follow existing patterns in codebase

## Current Implementation

### File Structure

```
~/.config/benchling-webhook/
├── default.json       # XDG config (secrets, settings)
└── deploy.json        # Deployment metadata
    ├── dev            # Dev deployment info
    │   ├── endpoint
    │   ├── imageTag
    │   ├── deployedAt  # ISO timestamp
    │   └── stackName
    └── prod           # Prod deployment info
```

### Current Test Flow

1. User runs `npm run test:dev`
2. npm invokes `make -C docker test-deployed-dev`
3. Makefile checks `jq -r '.dev.endpoint // empty' $(XDG_CONFIG)/deploy.json`
4. If empty, fail with error message
5. Otherwise, run `scripts/test_webhook.py` against endpoint

### Current Deploy Flow

1. User runs `npm run deploy:dev`
2. npm invokes `ts-node bin/dev-deploy.ts`
3. Script creates git tag, pushes to trigger CI
4. Waits for CI to build x86_64 image
5. Deploys CDK stack with CI image
6. Stores endpoint in `~/.config/benchling-webhook/deploy.json`

## Proposed Solution

### Architecture

```
npm run test:dev
    ↓
docker/Makefile: test-deployed-dev
    ↓
[NEW] Check if deployment needed
    ├─ No deploy.json? → deploy
    ├─ No dev section? → deploy
    ├─ Python sources newer? → deploy
    └─ SKIP_AUTO_DEPLOY=1? → skip
    ↓
[IF NEEDED] npm run deploy:dev
    ↓
[EXISTING] Test against endpoint
```

### Implementation Strategy

#### Option A: Makefile-Based (Recommended)

Add a new Makefile target that wraps `test-deployed-dev`:

```makefile
# Test deployed dev stack (auto-deploys if needed)
test-deployed-dev-auto: check-xdg
	@echo "🔍 Checking if dev deployment is needed..."
	@if [ -n "$(SKIP_AUTO_DEPLOY)" ]; then \
		echo "⏭️  Auto-deploy skipped (SKIP_AUTO_DEPLOY=1)"; \
		$(MAKE) test-deployed-dev; \
	else \
		DEPLOY_JSON=$(XDG_CONFIG)/deploy.json; \
		NEEDS_DEPLOY=0; \
		if [ ! -f "$$DEPLOY_JSON" ]; then \
			echo "📦 No deploy.json found"; \
			NEEDS_DEPLOY=1; \
		elif ! jq -e '.dev' "$$DEPLOY_JSON" >/dev/null 2>&1; then \
			echo "📦 No dev deployment found"; \
			NEEDS_DEPLOY=1; \
		else \
			DEPLOYED_AT=$$(jq -r '.dev.deployedAt // empty' "$$DEPLOY_JSON"); \
			if [ -z "$$DEPLOYED_AT" ]; then \
				echo "📦 No deployment timestamp found"; \
				NEEDS_DEPLOY=1; \
			else \
				DEPLOYED_EPOCH=$$(date -j -f "%Y-%m-%dT%H:%M:%S" "$${DEPLOYED_AT%.*}" +%s 2>/dev/null || echo 0); \
				NEWEST_PY=$$(find docker -name "*.py" -type f -exec stat -f %m {} \; | sort -rn | head -1); \
				if [ "$$NEWEST_PY" -gt "$$DEPLOYED_EPOCH" ]; then \
					echo "📦 Python sources newer than deployment"; \
					NEEDS_DEPLOY=1; \
				fi; \
			fi; \
		fi; \
		if [ "$$NEEDS_DEPLOY" = "1" ]; then \
			echo "🚀 Auto-deploying dev stack..."; \
			cd .. && npm run deploy:dev || exit 1; \
		else \
			echo "✅ Dev deployment is up-to-date"; \
		fi; \
		$(MAKE) test-deployed-dev; \
	fi
```

Update `package.json`:
```json
{
  "scripts": {
    "test:dev": "make -C docker test-deployed-dev-auto"
  }
}
```

**Pros:**
- Self-contained in Makefile
- Leverages existing Make infrastructure
- Fast file system operations
- No new dependencies

**Cons:**
- Shell script complexity in Makefile
- Date parsing varies by platform (GNU date vs BSD date)
- Harder to test in isolation

#### Option B: TypeScript Helper Script

Create `scripts/check-deploy-needed.ts`:

```typescript
#!/usr/bin/env ts-node

import { existsSync, statSync, readdirSync } from 'fs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface DeployConfig {
  dev?: {
    deployedAt: string;
    endpoint: string;
  };
}

function findNewestPythonFile(dir: string): number {
  let newest = 0;
  function walk(path: string) {
    const entries = readdirSync(path, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(path, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith('.py')) {
        const stat = statSync(fullPath);
        if (stat.mtimeMs > newest) {
          newest = stat.mtimeMs;
        }
      }
    }
  }
  walk(dir);
  return newest;
}

async function main() {
  const deployJsonPath = join(homedir(), '.config', 'benchling-webhook', 'deploy.json');

  // Check 1: deploy.json exists?
  if (!existsSync(deployJsonPath)) {
    console.log('📦 No deploy.json found - deployment needed');
    process.exit(1);
  }

  // Check 2: dev section exists?
  const config: DeployConfig = JSON.parse(readFileSync(deployJsonPath, 'utf8'));
  if (!config.dev) {
    console.log('📦 No dev deployment found - deployment needed');
    process.exit(1);
  }

  // Check 3: Python sources newer than deployment?
  const deployedAt = new Date(config.dev.deployedAt).getTime();
  const newestPython = findNewestPythonFile(join(process.cwd(), 'docker'));

  if (newestPython > deployedAt) {
    console.log('📦 Python sources newer than deployment - deployment needed');
    process.exit(1);
  }

  console.log('✅ Dev deployment is up-to-date');
  process.exit(0);
}

main();
```

Update Makefile:
```makefile
test-deployed-dev-auto: check-xdg
	@if [ -n "$(SKIP_AUTO_DEPLOY)" ]; then \
		echo "⏭️  Auto-deploy skipped (SKIP_AUTO_DEPLOY=1)"; \
		$(MAKE) test-deployed-dev; \
	else \
		if ! ts-node ../scripts/check-deploy-needed.ts 2>/dev/null; then \
			echo "🚀 Auto-deploying dev stack..."; \
			cd .. && npm run deploy:dev || exit 1; \
		fi; \
		$(MAKE) test-deployed-dev; \
	fi
```

**Pros:**
- Clean TypeScript code
- Easy to test and debug
- Platform-independent
- Better error handling

**Cons:**
- Additional TypeScript file
- Slightly slower (ts-node overhead)
- Another script to maintain

### Recommendation

**Use Option A (Makefile-Based)** because:
1. All deployment logic stays in Makefile (single source of truth)
2. Faster execution (no ts-node overhead)
3. Fewer files to maintain
4. Consistent with existing patterns (`test-local`, `test-ecr`)

Handle BSD date compatibility using ISO format and `date -j`:
```bash
# Convert ISO timestamp to epoch (works on macOS/BSD)
DEPLOYED_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${DEPLOYED_AT%.*}" +%s 2>/dev/null || echo 0)

# Get newest Python file modification time (BSD stat)
NEWEST_PY=$(find docker -name "*.py" -type f -exec stat -f %m {} \; | sort -rn | head -1)
```

For Linux compatibility, detect platform:
```bash
if [ "$(uname)" = "Darwin" ]; then
    # macOS/BSD
    STAT_CMD="stat -f %m"
    DATE_CMD="date -j -f %Y-%m-%dT%H:%M:%S"
else
    # Linux
    STAT_CMD="stat -c %Y"
    DATE_CMD="date -d"
fi
```

## Implementation Plan

### Phase 1: Add Makefile Target
1. Add `test-deployed-dev-auto` target to `docker/Makefile`
2. Implement deployment checks with platform detection
3. Add clear console output at each step
4. Test on macOS and Linux

### Phase 2: Update npm Script
1. Change `package.json` to use new target
2. Update `docker/Makefile` help text
3. Test the full workflow

### Phase 3: Documentation
1. Update `CLAUDE.md` with new behavior
2. Update README if applicable
3. Add examples in commit message

### Phase 4: Edge Cases
1. Handle corrupted `deploy.json`
2. Handle invalid timestamps
3. Handle permission errors
4. Add comprehensive error messages

## Testing Strategy

### Test Cases

1. **No deploy.json exists**
   ```bash
   rm -f ~/.config/benchling-webhook/deploy.json
   npm run test:dev
   # Expected: Auto-deploys, then tests
   ```

2. **deploy.json exists but no dev section**
   ```bash
   echo '{"prod":{}}' > ~/.config/benchling-webhook/deploy.json
   npm run test:dev
   # Expected: Auto-deploys, then tests
   ```

3. **Python source newer than deployment**
   ```bash
   # Deploy first
   npm run deploy:dev
   # Touch a Python file
   touch docker/src/app.py
   npm run test:dev
   # Expected: Auto-deploys, then tests
   ```

4. **Up-to-date deployment**
   ```bash
   npm run deploy:dev
   npm run test:dev
   # Expected: Skips deploy, tests immediately
   ```

5. **Skip auto-deploy**
   ```bash
   SKIP_AUTO_DEPLOY=1 npm run test:dev
   # Expected: Tests immediately (may fail if no deployment)
   ```

6. **Deployment fails**
   ```bash
   # Simulate failure (e.g., no AWS credentials)
   unset AWS_PROFILE
   npm run test:dev
   # Expected: Clear error, exit non-zero
   ```

## Success Criteria

1. ✅ `npm run test:dev` auto-deploys when needed
2. ✅ `npm run test:dev` skips deployment when up-to-date
3. ✅ Works on macOS (BSD) and Linux
4. ✅ Clear console output at each decision point
5. ✅ `SKIP_AUTO_DEPLOY=1` disables auto-deployment
6. ✅ Fails fast with clear errors
7. ✅ No breaking changes to existing workflows
8. ✅ All test cases pass

## Future Enhancements

1. **Cache invalidation**
   - Check Dockerfile changes
   - Check docker-compose.yml changes
   - Check CDK infrastructure changes

2. **Smart rebuild**
   - Only rebuild Docker image if source changed
   - Reuse CI images when possible

3. **Parallel testing**
   - Test against both dev and local simultaneously
   - Compare results for consistency

4. **Deployment history**
   - Track multiple deployments in deploy.json
   - Allow rollback to previous deployment
   - Show diff between deployments
