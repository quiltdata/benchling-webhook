# The Four Meanings of "dev" in the Benchling Webhook Project

## Executive Summary

The word "dev" is used throughout the project with **4 distinct meanings**, creating moderate confusion compared to the "local" terminology issue (which had 5 meanings). While "dev" usage is more consistent than "local", the overlapping contexts can lead to misconfiguration, especially for new users who might assume that profile names equal deployment stages.

This document catalogs all uses of "dev" in:
- package.json npm scripts
- Makefile targets and variables
- Docker Compose services
- Configuration profiles
- Git version tags
- Flask environment variables

---

## THE FOUR MEANINGS OF "DEV"

| # | Meaning | Examples | Scope | Confusing? |
| --- | --------- | ---------- | ------- | ------------ |
| 1. **Profile Name** | `--profile dev`, `PROFILE=dev` | Configuration files in `~/.config/benchling-webhook/dev/` | ⚠️ Independent of stage! |
| 2. **Deployment Stage** | `--stage dev` | AWS API Gateway stage (e.g., `/dev/webhook`) | ⚠️ Independent of profile! |
| 3. **Docker Service** | `app-dev`, `--profile dev` (Compose) | Hot-reload container on port 5002 | ✅ Clear context |
| 4. **Version Tag** | `v0.7.2-20251106T010445Z` | Pre-release git tags with timestamps | ✅ Clear pattern |

---

## DETAILED INVENTORY

### 1. Profile Name (Configuration Source)

**What it is**: A named configuration directory in `~/.config/benchling-webhook/dev/`

**Purpose**: Stores credentials, AWS region, image tags, and deployment settings

**Key Files**:
- `~/.config/benchling-webhook/dev/config.json` - Profile configuration
- `~/.config/benchling-webhook/dev/deployments.json` - Deployment tracking

**Example Configuration**:
```json
{
  "_inherits": "default",
  "benchling": {
    "appDefinitionId": "app_dev_123",
    "tenant": "my-tenant"
  },
  "deployment": {
    "imageTag": "latest",
    "awsRegion": "us-east-1",
    "awsAccountId": "123456789012"
  },
  "logging": {
    "level": "DEBUG"
  }
}
```

**Usage Locations**:

| File | Line | Context |
| ------ | ------ | --------- |
| `docker/Makefile` | 11 | `PROFILE ?= dev` (default value) |
| `package.json` | 21 | `deploy:dev` uses `--profile dev` |
| `package.json` | 31 | `setup:dev` uses `--profile dev` |
| `package.json` | 39 | `test:dev` passes `PROFILE=dev` to Makefile |
| `bin/cli.ts` | 67 | Example: `--profile dev` |
| `bin/commands/deploy.ts` | 119-129 | Special logic for profile named "dev" |
| `docker/scripts/run_native.py` | default | `profile="dev"` as default argument |

**Critical Distinction**: Profile is the **configuration source**, NOT the deployment target!

**Valid (but potentially confusing) combinations**:
```bash
# Deploy dev profile to prod stage
npm run deploy -- --profile dev --stage prod

# Deploy sales profile to dev stage
npm run deploy -- --profile sales --stage dev
```

---

### 2. Deployment Stage (AWS Infrastructure Target)

**What it is**: An AWS API Gateway stage name that determines the URL path and CloudFormation stack name

**Purpose**: Creates separate deployment environments in AWS (e.g., `https://api.example.com/dev/webhook`)

**Key Characteristics**:
- Creates API Gateway stage: `/dev` or `/prod`
- CloudFormation stack: `BenchlingWebhookStack-dev` or `BenchlingWebhookStack-prod`
- Tracked in `deployments.json` under `active.dev` or `active.prod`
- **Independent of profile** (by design since v0.7.0)

**Example Deployment Record**:
```json
{
  "active": {
    "dev": {
      "stage": "dev",
      "endpoint": "https://xxx.execute-api.us-east-1.amazonaws.com/dev",
      "stackName": "BenchlingWebhookStack-dev",
      "imageTag": "0.7.2-20251106T010445Z",
      "timestamp": "2025-11-06T01:05:00Z"
    },
    "prod": {
      "stage": "prod",
      "endpoint": "https://xxx.execute-api.us-east-1.amazonaws.com/prod",
      "stackName": "BenchlingWebhookStack-prod",
      "imageTag": "0.7.2",
      "timestamp": "2025-11-05T18:30:00Z"
    }
  }
}
```

**Usage Locations**:

| File | Line | Context |
| ------ | ------ | --------- |
| `bin/cli.ts` | 67 | `--stage <name>: "dev or prod"` |
| `package.json` | 21 | `deploy:dev` uses `--stage dev` |
| `package.json` | 22 | `deploy:prod` uses `--stage prod` |
| `lib/benchling-webhook-stack.ts` | N/A | Stack name includes stage |
| `lib/wizard/phase7-standalone-mode.ts` | N/A | `stage: profile === "prod" ? "prod" : "dev"` |
| `docker/Makefile` | 254-295 | `test-deployed-dev` checks for dev stage deployment |

**Default Behavior**: Stage defaults to `prod` unless explicitly set to `dev`

**Common Pattern**:
```bash
# Typical usage (profile matches stage)
npm run deploy:dev      # --profile dev --stage dev
npm run deploy:prod     # --profile prod --stage prod

# Advanced usage (profile differs from stage)
npm run deploy -- --profile sales --stage dev
```

---

### 3. Docker Service Profile (Hot-Reload Development)

**What it is**: A Docker Compose service with live code reloading and debug logging

**Purpose**: Run Flask app locally with instant feedback during development

**Key Characteristics**:
- Service name: `app-dev` (vs production service `app`)
- Port: `5002` (vs production `5003`)
- Volume mounts: `./src:/app/src` for hot-reload
- Environment: `FLASK_ENV=development`, `LOG_LEVEL=DEBUG`
- Activated via: `docker-compose --profile dev up`

**Docker Compose Configuration**:
```yaml
# docker/docker-compose.yml
services:
  app-dev:
    profiles: ["dev"]
    build:
      context: .
      dockerfile: Dockerfile
      target: development
    ports:
      - "5002:5000"
    env_file:
      - ../.env
    environment:
      - FLASK_ENV=development
      - LOG_LEVEL=${LOG_LEVEL:-DEBUG}
    volumes:
      - ./src:/app/src        # Hot-reload enabled
      - ./tests:/app/tests
    command: ["sh", "-c", "uv sync && uv run python -m src.app"]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5000/health"]
      interval: 10s
      timeout: 5s
      retries: 3
```

**Makefile Targets**:

| Target | Port | Purpose |
| -------- | ------ | --------- |
| `run` / `run-dev` | 5002 | Start Docker dev service |
| `test-dev` | 5002 | Test webhooks against Docker dev |
| `health-dev` | 5002 | Health check Docker dev |
| `logs-dev` | N/A | Show Docker dev logs |

**Usage Examples**:
```bash
# Start Docker dev service
make -C docker run-dev

# Test against Docker dev
make -C docker test-dev

# Watch logs
make -C docker logs-dev

# Using docker-compose directly
cd docker && docker-compose --profile dev up
```

**Port Configuration** (from `docker/Makefile`):
```makefile
PORT_NATIVE := 5001           # Native Python (no Docker)
PORT_DOCKER_DEV := 5002       # Docker dev service
PORT_DOCKER_PROD := 5003      # Docker prod service
```

---

### 4. Development Version Tags (Pre-Release Tracking)

**What it is**: Git tags with timestamp suffixes for pre-release versions

**Purpose**: Track development releases for testing before production

**Key Characteristics**:
- Pattern: `v{version}-{timestamp}Z` (e.g., `v0.7.2-20251106T010445Z`)
- Timestamp format: `YYYYMMDDTHHMMSSZ` (ISO 8601 compact)
- Auto-detected for deployments using `dev` profile
- Distinguished from production tags (e.g., `v0.7.2` without timestamp)

**Creation Commands**:
```bash
# Create dev version tag
npm run version:dev              # Increments version in package.json
npm run version:tag:dev          # Creates git tag with timestamp

# Example result
git tag v0.7.2-20251106T010445Z
```

**Auto-Detection Logic** (from `bin/commands/deploy.ts`):
```typescript
// Special handling for "dev" profile
if (profileName === "dev") {
    const devVersion = getLatestDevVersion();
    if (devVersion) {
        console.log(`Auto-detected dev version: ${devVersion}`);
        imageTag = devVersion;
    } else {
        console.log("No dev version tag found, using 'latest'");
        imageTag = "latest";
    }
}
```

**Detection Implementation** (from `scripts/get-dev-version.ts`):
```typescript
function getLatestDevVersion(): string | null {
    const tags = execSync("git tag --list", { encoding: "utf8" })
        .trim()
        .split("\n")
        .filter(tag => /^v\d+\.\d+\.\d+-\d{8}T\d{6}Z$/.test(tag));

    // Sort by timestamp (newest first)
    tags.sort((a, b) => {
        const timestampA = a.match(/(\d{8}T\d{6}Z)$/)?.[1] || "";
        const timestampB = b.match(/(\d{8}T\d{6}Z)$/)?.[1] || "";
        return timestampB.localeCompare(timestampA);
    });

    return tags[0]?.substring(1); // Remove 'v' prefix
}
```

**Stack Version Determination** (from `lib/benchling-webhook-stack.ts`):
```typescript
// Detect if this is a dev version tag
const isDevVersion = imageTagValue.match(/^\d+\.\d+\.\d+-\d{8}T\d{6}Z$/);

// Use dev version for stack versioning, or package.json version for prod
const stackVersion = isDevVersion ? imageTagValue : packageJson.version;
```

**Example Tag Timeline**:
```
v0.7.2-20251106T010445Z  ← Latest dev version (auto-detected)
v0.7.2-20251105T183000Z  ← Previous dev version
v0.7.2                   ← Production release
v0.7.1-20251104T120000Z  ← Old dev version
v0.7.1                   ← Previous production
```

---

## ADDITIONAL "DEV" CONTEXTS

### 5. Flask Development Mode

**What it is**: Flask framework's built-in development mode

**Purpose**: Enables debug mode, detailed error pages, auto-reload

**Key Characteristics**:
- Environment variable: `FLASK_ENV=development` (vs `production`)
- Affects logging format: Plain text in dev, JSON in production
- Enables Flask debugger and detailed tracebacks
- Standard Flask convention (not project-specific)

**Usage**:
```yaml
# docker-compose.yml
environment:
  - FLASK_ENV=development    # Dev service
  # vs
  - FLASK_ENV=production     # Prod service
```

**Application Logic** (from `docker/src/app.py`):
```python
# Determine logging format
use_json_logs = os.getenv("FLASK_ENV", "development") == "production"

# Set debug mode
debug = os.getenv("FLASK_ENV") == "development"
```

---

## RELATIONSHIP MATRIX

| Meaning | Scope | Default | Port | Environment Variable | File Location |
| --------- | ------- | --------- | ------ | --------------------- | --------------- |
| **Profile Name** | Configuration | `dev` | N/A | `PROFILE=dev` | `~/.config/benchling-webhook/dev/` |
| **Deployment Stage** | AWS Infrastructure | `prod` | N/A | N/A | Stack name, API Gateway |
| **Docker Service** | Local Development | `app` (prod) | 5002 | `FLASK_ENV=development` | `docker-compose.yml` |
| **Version Tag** | Release Management | N/A | N/A | N/A | Git tags |
| **Flask Mode** | Application Runtime | `development` | N/A | `FLASK_ENV=development` | Python app config |

**Key Insight**: Profile, Stage, and Docker Service are **completely independent** - you can mix and match!

---

## CONFUSION POINTS

### 🏆 #1: Profile vs Stage Independence

**The Problem**: Users assume profile name = deployment stage

**Reality**: They are independent by design (since v0.7.0)

**Confusing Example**:
```bash
# This deploys DEV profile credentials to PROD stage!
npm run deploy -- --profile dev --stage prod
```

**What Actually Happens**:
1. Loads configuration from `~/.config/benchling-webhook/dev/config.json`
2. Uses dev profile's AWS credentials and image tags
3. Deploys to AWS API Gateway stage named "prod"
4. Creates/updates stack `BenchlingWebhookStack-prod`

**Why This Design?**:
- Allows testing production-like configurations in dev stage
- Enables multiple teams to have separate profiles (e.g., "sales") deploying to shared stages
- Flexibility for complex deployment scenarios

**Mitigation**: Documentation in `spec/189-multi/01-spec.md` explains the distinction

---

### 🥈 #2: Docker vs AWS Command Confusion

**The Problem**: Similar command names do completely different things

**Examples**:

| Command | What Users Think | What It Actually Does |
| --------- | ------------------ | ---------------------- |
| `npm run deploy:dev` | Deploys Docker dev container | Deploys to AWS dev stage using dev profile |
| `make run-dev` | Runs dev version in AWS | Starts Docker dev container locally on port 5002 |
| `npm run test:dev` | Tests Docker dev container | Tests AWS dev stage deployment (and auto-deploys if needed!) |
| `make test-dev` | Tests AWS dev deployment | Tests Docker dev container on port 5002 |

**Resolution**: Context matters!
- `npm` commands → AWS operations
- `make` commands → Docker operations (when in `docker/` directory)

---

### 🥉 #3: Auto-Deployment Surprise

**The Problem**: Test command triggers deployment as a side effect

**Command**: `npm run test:dev`

**What Happens**:
```makefile
# docker/Makefile:254-295
test-deployed-dev: check-xdg
    @# Check if deployment is needed
    @if [ ! -f "$(XDG_CONFIG)/$(PROFILE)/deployments.json" ]; then
        echo "No deployments.json found. Auto-deploying..."
        npm run deploy:dev -- $(DEPLOY_FLAGS)
    elif [ ! -s "$(XDG_CONFIG)/$(PROFILE)/deployments.json" ] || \
         ! jq -e '.active.dev' "$(XDG_CONFIG)/$(PROFILE)/deployments.json"; then
        echo "No dev deployment found. Auto-deploying..."
        npm run deploy:dev -- $(DEPLOY_FLAGS)
    elif [ "$$NEEDS_DEPLOY" = "1" ]; then
        echo "Python sources are newer than deployment. Auto-deploying..."
        npm run deploy:dev -- $(DEPLOY_FLAGS)
    fi
    @# Then run tests...
```

**When Auto-Deploy Triggers**:
1. No `deployments.json` file exists
2. No `dev` section in `deployments.json`
3. Python source files are newer than last deployment timestamp

**Disable Auto-Deploy**:
```bash
# Skip auto-deployment
npm run test:dev -- --no-deploy

# Or set environment variable
SKIP_AUTO_DEPLOY=1 npm run test:dev
```

**Rationale**: Ensures tests always run against latest code, prevents stale deployments

---

### ⚠️ #4: Dev Version Tag Auto-Detection

**The Problem**: Dev profile has special behavior for image tags

**Special Logic** (from `bin/commands/deploy.ts`):
```typescript
if (profileName === "dev") {
    // Auto-detect latest dev version tag
    const devVersion = getLatestDevVersion();
    if (devVersion) {
        imageTag = devVersion;  // e.g., "0.7.2-20251106T010445Z"
    } else {
        imageTag = "latest";    // Fallback if no dev tags exist
    }
} else {
    // Other profiles use config or "latest"
    imageTag = config.deployment?.imageTag || "latest";
}
```

**Implications**:
- **Dev profile**: Automatically uses latest timestamped dev tag
- **Other profiles**: Use `imageTag` from config.json or "latest"
- **Override**: Use `--image-tag` flag to specify explicitly

**Example**:
```bash
# Uses auto-detected dev version (e.g., 0.7.2-20251106T010445Z)
npm run deploy:dev

# Uses specific version
npm run deploy:dev -- --image-tag 0.7.2

# Other profiles use config.json imageTag setting
npm run deploy:prod  # Uses prod profile's imageTag from config
```

---

## COMPLETE INVENTORY: EVERY "DEV" USAGE

### Package.json Scripts (6 scripts)

| Script | Profile | Stage | Purpose |
| -------- | --------- | ------- | --------- |
| `deploy:dev` | `dev` | `dev` | Deploy dev profile to dev stage |
| `setup:dev` | `dev` | N/A | Configure dev profile |
| `test:dev` | `dev` | `dev` | Test dev stage (auto-deploys if needed) |
| `test:native` | `dev` | N/A | Test native Python with dev profile |
| `version:dev` | N/A | N/A | Increment dev version |
| `version:tag:dev` | N/A | N/A | Create dev version git tag |

### Makefile Targets (8 targets in docker/Makefile)

| Target | Type | Port | Purpose |
| -------- | ------ | ------ | --------- |
| `run` / `run-dev` | Docker | 5002 | Start Docker dev service |
| `test-dev` | Docker | 5002 | Test Docker dev service |
| `health-dev` | Docker | 5002 | Health check Docker dev |
| `logs-dev` | Docker | N/A | Show Docker dev logs |
| `test-deployed-dev` | AWS | N/A | Test AWS dev stage (auto-deploys) |
| `test-deployed-dev-only` | AWS | N/A | Test AWS dev stage (no auto-deploy) |

### Makefile Variables (2 variables)

| Variable | Value | Purpose |
| ---------- | ------- | --------- |
| `PROFILE` | `dev` (default) | Default profile name |
| `PORT_DOCKER_DEV` | `5002` | Docker dev service port |

### Docker Services (1 service)

| Service | Profile | Port | Environment |
| --------- | --------- | ------ | ------------- |
| `app-dev` | `dev` | 5002 | `FLASK_ENV=development` |

### TypeScript/JavaScript Files (15+ files)

| File | Dev References | Type |
| ------ | ---------------- | ------ |
| `bin/cli.ts` | Examples with `--profile dev`, `--stage dev` | Profile + Stage |
| `bin/commands/deploy.ts` | Auto-detect logic for dev profile | Profile + Version Tags |
| `bin/commands/setup-profile.ts` | Default logic for dev profile | Profile |
| `lib/next-steps-generator.ts` | `if (profile === "dev")` suggestions | Profile |
| `lib/wizard/phase7-standalone-mode.ts` | Profile → stage mapping | Profile + Stage |
| `scripts/get-dev-version.ts` | Entire file for dev version detection | Version Tags |
| `scripts/version.ts` | `tag dev` command | Version Tags |

### Python Files (5+ files)

| File | Dev References | Type |
| ------ | ---------------- | ------ |
| `docker/src/app.py` | `FLASK_ENV == "development"` | Flask Mode |
| `docker/scripts/run_native.py` | `profile="dev"` default | Profile |
| `docker/scripts/test_webhook.py` | `profile = "dev"` default | Profile |
| `docker/scripts/test_benchling.py` | `--profile dev` example | Profile |
| `docker/scripts/test_query.py` | `--profile dev` example | Profile |

### Configuration Files (3 files)

| File | Dev References | Type |
| ------ | ---------------- | ------ |
| `docker-compose.yml` | `app-dev` service, `profiles: ["dev"]` | Docker Service |
| `.env.example` | `FLASK_ENV=development` | Flask Mode |
| `test/fixtures/config-v0.7.0-dev.json` | Test fixture | Profile |

---

## USAGE PATTERNS BY CONTEXT

### Repository Development (Cloned Repo)

```bash
# Setup dev profile
npm run setup:dev
# → Creates ~/.config/benchling-webhook/dev/config.json

# Deploy to AWS dev stage
npm run deploy:dev
# → Uses dev profile, deploys to dev stage, auto-detects dev version tag

# Test deployed dev stack
npm run test:dev
# → Auto-deploys if needed, then tests dev stage endpoint

# Run Docker dev server locally
make -C docker run-dev
# → Starts app-dev service on port 5002

# Test Docker dev server
make -C docker test-dev
# → Tests http://localhost:5002

# Create dev version tag
npm run version:tag:dev
# → Creates v{version}-{timestamp}Z tag
```

### NPX Usage (Standalone)

```bash
# Setup dev profile
npx @quiltdata/benchling-webhook --profile dev

# Deploy dev profile to dev stage (typical)
npx @quiltdata/benchling-webhook deploy --profile dev --stage dev

# Deploy dev profile to prod stage (advanced)
npx @quiltdata/benchling-webhook deploy --profile dev --stage prod
```

### Python Scripts (Native Execution)

```bash
# Test with dev profile (default)
cd docker
uv run python scripts/run_native.py --profile dev

# Test Benchling credentials
uv run python scripts/test_benchling.py --profile dev

# Query Quilt packages
uv run python scripts/test_query.py --profile dev
```

---

## NAMING CONSISTENCY ANALYSIS

### ✅ Consistent Patterns

1. **Profile naming**: Always lowercase `dev` (never `Dev`, `DEV`, `Development`)
2. **Stage naming**: Always lowercase `dev` or `prod` (no mixed case)
3. **Docker service**: Always hyphenated `app-dev` (not `appDev`, `app_dev`)
4. **Makefile targets**: Always hyphenated (`test-dev`, `run-dev`, `logs-dev`)
5. **npm scripts**: Always colon-separated (`deploy:dev`, `test:dev`, `setup:dev`)

### ⚠️ Minor Inconsistencies

1. **Version tags**: Use hyphen but uppercase Z (`v0.7.2-20251106T010445Z`)
2. **FLASK_ENV**: Uses `development` (not `dev`)
3. **Docker Compose profiles**: Lowercase array `["dev"]` but activated via `--profile dev`

---

## AMBIGUITY HOTSPOTS

### Critical Ambiguity: Command Name Overlap

**Problem**: Similar names for Docker vs AWS operations

| Command | Actual Target | Port/Stage | Users Might Think |
| --------- | --------------- | ------------ | ------------------- |
| `npm run deploy:dev` | AWS dev stage | N/A | Docker dev container |
| `make run-dev` | Docker dev service | 5002 | AWS dev environment |
| `npm run test:dev` | AWS dev stage | N/A | Docker dev container |
| `make test-dev` | Docker dev service | 5002 | AWS dev stage |

**Resolution**:
- Context matters: `npm` = AWS, `make` = Docker
- Port number indicates target: 5002 = Docker dev, no port = AWS

### Moderate Ambiguity: Profile vs Stage

**Problem**: Profile and stage are independent but often have same name

**Example**:
```bash
# These use DIFFERENT "dev" meanings:
npm run deploy:dev
#                └─ Stage name (deployment target)
#            └─ Profile name (config source)
```

**Confusion**: Users assume profile = stage (they're not!)

**Valid but unexpected**:
```bash
# Deploy dev profile to prod stage (uses dev credentials in prod!)
npm run deploy -- --profile dev --stage prod
```

### Low Ambiguity: Flask Development Mode

**Context**: `FLASK_ENV=development` is standard Flask convention

**Clarity**: Well-documented, minimal confusion, uses full word "development"

---

## RECOMMENDATIONS

### 1. Documentation Improvements

Add to `CLAUDE.md`:

```markdown
#### Understanding "dev" in Benchling Webhook

The term "dev" has **FOUR distinct meanings**:

1. **Profile Name** (`--profile dev`)
   - Configuration source: `~/.config/benchling-webhook/dev/`
   - Contains credentials, AWS settings, image tags

2. **Deployment Stage** (`--stage dev`)
   - AWS deployment target: API Gateway stage `/dev`
   - CloudFormation stack: `BenchlingWebhookStack-dev`
   - **Independent of profile!**

3. **Docker Service** (`app-dev`)
   - Hot-reload container on port 5002
   - Activated via `make -C docker run-dev`

4. **Version Tag** (`v0.7.2-20251106T010445Z`)
   - Pre-release git tags with timestamps
   - Auto-detected for dev profile deployments

**Common Commands**:
```bash
# AWS operations (npm)
npm run deploy:dev      # Deploy dev profile → dev stage
npm run test:dev        # Test dev stage (auto-deploys)

# Docker operations (make)
make -C docker run-dev  # Start Docker dev service (port 5002)
make -C docker test-dev # Test Docker dev service

# Version management
npm run version:tag:dev # Create dev version tag
```

**Key Distinction**: Profile ≠ Stage!
- Profile = WHERE config comes from (`~/.config/benchling-webhook/dev/`)
- Stage = WHERE you're deploying to (AWS stage named "dev" or "prod")
```

### 2. Validation Warnings (Optional)

Add to `bin/commands/deploy.ts`:

```typescript
// Warn about confusing profile/stage combinations
if (profileName === "dev" && stage === "prod") {
    console.warn(chalk.yellow("⚠️  Warning: Deploying DEV profile to PROD stage"));
    console.warn(chalk.yellow("    This uses dev credentials in production environment!"));

    if (!options.yes) {
        const { confirm } = await inquirer.prompt([{
            type: "confirm",
            name: "confirm",
            message: "Are you sure you want to continue?",
            default: false
        }]);

        if (!confirm) {
            process.exit(1);
        }
    }
}
```

### 3. Command Aliases (Optional)

Add to `package.json` for clearer intent:

```json
{
  "scripts": {
    "docker:dev:start": "make -C docker run-dev",
    "docker:dev:test": "make -C docker test-dev",
    "aws:dev:deploy": "npm run deploy:dev",
    "aws:dev:test": "npm run test:dev"
  }
}
```

### 4. Naming Improvements (Low Priority)

Consider renaming for clarity:

| Current | Better Alternative | Why |
| --------- | ------------------- | ----- |
| `test-dev` | `test-docker-dev` | Clarify it's Docker, not AWS |
| `run-dev` | `run-docker-dev` | Match port naming pattern |
| `test:dev` | `test:aws:dev` | Clarify AWS target |

**Note**: These changes would break existing workflows, so low priority

---

## COMPARISON TO "LOCAL" TERMINOLOGY

| Aspect | "local" | "dev" |
| -------- | --------- | ------- |
| **Distinct Meanings** | 5 | 4 |
| **Scope** | Mostly local development | Local + AWS + Git + Flask |
| **Consistency** | Low (5 unrelated meanings) | High (4 related meanings) |
| **Ambiguity Level** | High | Moderate |
| **User Confusion** | High (completely different concepts) | Moderate (overlapping contexts) |
| **Naming Patterns** | Mixed | Consistent |
| **Documentation** | Needed renaming | Needs clarification only |

**Key Difference**:
- **"local"** had 5 completely unrelated meanings (mode, target, image, script, build)
- **"dev"** has 4 related meanings that all refer to "development" but in different scopes

**Assessment**:
- **"local"** → Required renaming to "native" for non-Docker usage
- **"dev"** → Requires better documentation, but naming is acceptable

---

## SUMMARY STATISTICS

| Category | Count | Notes |
| ---------- | ------- | ------- |
| **Distinct Meanings** | 4 | Profile, Stage, Docker Service, Version Tag |
| **Project Files with "dev"** | ~60 | Excluding node_modules |
| **Makefile Targets** | 8 | All in docker/Makefile |
| **npm Scripts** | 6 | deploy, setup, test, version |
| **Docker Services** | 1 | app-dev |
| **Port Configurations** | 1 | PORT_DOCKER_DEV := 5002 |
| **Environment Variables** | 2 | PROFILE, FLASK_ENV |
| **Configuration Profiles** | 1+ | dev (and others like sales, prod) |

---

## CONCLUSION

The "dev" terminology in the Benchling Webhook project is **more consistent than "local"** but still presents **moderate ambiguity** due to overlapping contexts:

### Strengths

1. **Consistent naming patterns**: Lowercase, hyphenated, colon-separated
2. **Clear architectural separation**: Profile vs stage independence (v0.7.0+)
3. **Well-designed**: Each "dev" meaning serves a distinct purpose
4. **Good defaults**: Profile defaults to "dev", stage defaults to "prod"

### Weaknesses

1. **Profile vs stage confusion**: Users might assume they're the same
2. **Command name overlap**: Docker vs AWS operations use similar names
3. **Auto-deployment surprise**: `test:dev` triggers deployment as side effect
4. **Special logic for dev profile**: Auto-detects version tags (not obvious)

### Risk Assessment

- **Consistency**: ✅ Excellent (uniform naming conventions)
- **Clarity**: ⚠️ Moderate (needs better documentation)
- **Risk**: 🟡 Low-to-moderate (mostly affects new users)
- **Architecture**: ✅ Well-designed (profile/stage separation is correct)

### Recommended Actions

1. **High Priority**: Improve documentation (add to CLAUDE.md, README)
2. **Medium Priority**: Add validation warnings for confusing combinations
3. **Low Priority**: Consider command aliases for clarity
4. **No Action**: Naming is good, don't rename (unlike "local")

**Overall**: The current implementation is **well-architected and functional**. The main issue is **discoverability and documentation**, not design flaws. Unlike "local" (which needed renaming), "dev" just needs better explanation of its four distinct but related meanings.
