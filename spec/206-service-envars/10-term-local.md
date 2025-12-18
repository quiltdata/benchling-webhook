# The Confusing Use of "local" in the Benchling Webhook Project

## Executive Summary

The word "local" is used inconsistently across the project with at least **5 different meanings**, creating significant confusion. This document catalogs all uses of "local" in:
- package.json npm scripts
- Makefile targets
- Filenames
- Port configurations

---

## THE FIVE MEANINGS OF "LOCAL"

| Meaning | Examples | Confusing? |
| --------- | ---------- | ------------ |
| 1. **Native Python** (not Docker) | `run-local`, `PORT_LOCAL`, `test-local` | ✅ Consistent |
| 2. **Built on dev machine** (not CI) | `docker-build-local` | ✅ Makes sense |
| 3. **Built on dev machine BUT pushed to AWS** | `push-local` | ❌ VERY CONFUSING! |
| 4. **Not deployed** (vs AWS ECS) | `test:local` | ⚠️ Ambiguous |
| 5. **Port for Python** (vs Docker ports) | `PORT_LOCAL` = 5001 | ⚠️ Why not PORT_PYTHON? |

---

## DETAILED INVENTORY

### Package.json (1 script)

| Script | Uses Docker? | Port | What "local" means |
| -------- | -------------- | ------ | ------------------- |
| `test:local` | Builds image, tests Python | 5001 | "Not deployed to AWS" |

**Problem:** Builds Docker but tests native Python - why build Docker at all?!

---

### Makefile (7 targets)

| Target | Uses Docker? | Port | What "local" means | Pushes to AWS? |
| -------- | -------------- | ------ | ------------------- | ---------------- |
| `run-local` | NO | 5001 | Native Python | NO |
| `run-local-verbose` | NO | 5001 | Native Python | NO |
| `run-local-ngrok` | NO | 5001 | Native Python + tunnel | NO |
| `test-local` | NO | 5001 | Test native Python | NO |
| `health-local` | NO | 5001 | Check native Python | NO |
| `docker-build-local` | YES | N/A | Built on dev machine | NO |
| `push-local` | YES | N/A | Built on dev machine | **YES!** 🤯 |

**The Big Problems:**

1. **`push-local` PUSHES TO AWS ECR!** Despite "local" in the name, it uploads to remote AWS!
2. **Three different ports, all "local":**
   - `PORT_LOCAL` (5001) = Native Python
   - `PORT_DOCKER_DEV` (5002) = Docker on your machine
   - `PORT_DOCKER_PROD` (5003) = Docker on your machine

   All three run locally on your laptop! Why is only one called "local"?

---

### Files (1 file)

| File | What it does | What "local" means |
| ------ | -------------- | ------------------- |
| `run_local.py` | Runs Flask in native Python | Runs on your machine (but pulls secrets from AWS!) |

**Problem:** It's "local execution" but "remote configuration" - confusing!

---

## THE MOST CONFUSING EXAMPLES

### 🏆 #1: `push-local` - Pushes to REMOTE AWS!

```makefile
push-local: docker-tools docker-ecr-create
    @echo "Building and pushing architecture-specific Docker image (local)..."
    DOCKER_IMAGE_NAME=$(DOCKER_IMAGE_BASE)-$(ARCH) uv run python scripts/docker.py push
```

**Despite being called "local", this pushes to ECR in AWS!**

The only "local" thing about it is WHERE it's built (your dev machine vs CI server).

---

### 🥈 #2: `test:local` vs `test-local` - Same Name, Different Behavior!

**NPM:** `npm run test:local`
- Builds Docker image (but doesn't use it!)
- Tests native Python server
- Port 5001

**Make:** `make test-local`
- Doesn't touch Docker at all
- Tests native Python server
- Port 5001

**Why does npm script build Docker if it won't use it?!**

---

### 🥉 #3: Three "Local" Ports

```makefile
PORT_LOCAL := 5001          # Native Python
PORT_DOCKER_DEV := 5002     # Docker on your laptop
PORT_DOCKER_PROD := 5003    # Docker on your laptop
```

**All three run on your local machine! But only one is called "local"!**

Should be:
- `PORT_PYTHON` or `PORT_NATIVE` = 5001
- `PORT_DOCKER_DEV` = 5002
- `PORT_DOCKER_PROD` = 5003

---

## COMPLETE INVENTORY: EVERY "LOCAL" USAGE

| Command/File | Docker? | Port | AWS Push? | AWS Pull? | What "local" means |
| -------------- | --------- | ------ | ----------- | ----------- | ------------------- |
| `npm run test:local` | Build only | 5001 | NO | YES | "Not deployed" |
| `make run-local` | NO | 5001 | NO | YES | "Native Python" |
| `make run-local-verbose` | NO | 5001 | NO | YES | "Native Python" |
| `make run-local-ngrok` | NO | 5001 | NO | YES | "Native Python" |
| `make test-local` | NO | 5001 | NO | YES | "Native Python" |
| `make health-local` | NO | 5001 | NO | YES | "Native Python" |
| `make docker-build-local` | YES | N/A | NO | NO | "Built on dev machine" |
| `make push-local` | YES | N/A | **YES!** | NO | "Built on dev machine" |
| `PORT_LOCAL` | NO | 5001 | N/A | N/A | "Python port" |
| `run_local.py` | NO | 5001 | NO | YES | "Run on machine" |

---

## HOW ENVIRONMENT VARIABLES FLOW

### The Surprising Truth: `npm run test:local` Doesn't Use Docker!

Despite being in the `docker/` directory, **`test:local` actually runs Python directly on your host machine**, not in a Docker container. Here's the complete flow:

```
npm run test:local
    ↓
make -C docker build && make -C docker test-local PROFILE=dev
    ↓
docker build (creates image, but doesn't use it for testing)
    ↓
uv run python scripts/run_local.py --test --profile dev
    ↓
[Python runs directly on host - NOT in Docker]
```

### How Environment Variables Are Actually Passed

**`run_local.py`** handles all the environment setup:

1. **Loads profile config** from `~/.config/benchling-webhook/dev/config.json`
2. **Fetches secrets** from AWS Secrets Manager using the ARNs in the config
3. **Sets environment variables** programmatically in Python:
   ```python
   env_vars = {
       "QuiltStackARN": quilt_stack_arn,
       "BenchlingSecret": benchling_secret_arn,
       "AWS_REGION": aws_region,
       "FLASK_ENV": "development",
       "FLASK_DEBUG": "true",
   }

   for key, value in env_vars.items():
       os.environ[key] = str(value)
   ```
4. **Then imports Flask app** which reads from `os.environ`

### Why No .env File?

The `.env` file is **only used for Docker Compose** (`docker-compose up`), not for `test:local`. The environment variables are set programmatically in Python instead.

### When Docker IS Used

Docker containers get environment variables in these scenarios:

1. **docker-compose.yml** - Uses `env_file: ../.env` to pass variables
2. **ECS Deployment** - Environment variables are set in the ECS task definition
3. **Manual docker run** - Would need `-e` flags or `--env-file`

---

## PROPOSED TERMINOLOGY CHANGES

### Things to Rename from "local" to "native" (Non-Docker)

These all refer to native Python execution (not Docker):

1. `PORT_LOCAL` → `PORT_NATIVE` (Makefile variable)
2. `make run-local` → `make run-native` (Makefile target)
3. `make run-local-verbose` → `make run-native-verbose` (Makefile target)
4. `make run-local-ngrok` → `make run-native-ngrok` (Makefile target)
5. `make test-local` → `make test-native` (Makefile target)
6. `make health-local` → `make health-native` (Makefile target)
7. `npm run test:local` → `npm run test:native` (package.json script)
8. `run_local.py` → `run_native.py` (filename)

### Things to Keep as "local" (Docker-Related)

These refer to Docker operations on the local dev machine:

1. `make docker-build-local` - Keep (builds Docker locally)
2. `make push-local` - Keep (builds Docker locally and pushes)
3. `PORT_DOCKER_DEV` - Keep (Docker container on dev machine)
4. `PORT_DOCKER_PROD` - Keep (Docker container on dev machine)

---

## RECOMMENDED NAMING CONVENTION

| Current Name | Better Name | Why |
| -------------- | ------------- | ----- |
| `push-local` | `push-from-dev` or `push-with-arch` | Makes clear it pushes TO AWS |
| `PORT_LOCAL` | `PORT_NATIVE` | Clarifies it's for native Python |
| `test:local` | `test:native` | Clarifies it tests Python (not Docker) |
| `run_local.py` | `run_native.py` | Emphasizes native Python execution |

---

## THE ROOT PROBLEM

**"Local" is used to mean 5 different things:**

1. **Local machine** (vs deployed AWS infrastructure)
2. **Native Python** (vs Docker container)
3. **Built on dev machine** (vs built in CI)
4. **Not deployed** (vs deployed to AWS)
5. **Specific port number** (5001 vs other ports)

**This creates massive confusion because:**
- Docker containers running on your laptop are "local" to your machine
- Native Python running on your laptop is also "local" to your machine
- Building Docker images on your laptop is "local" building
- But pushing those images to ECR is "remote" deployment
- Yet we call it "push-local"!

**The project needs consistent terminology that distinguishes:**
- **Execution environment:** Native Python vs Docker vs AWS ECS
- **Build location:** Dev machine vs CI server
- **Deployment status:** Local-only vs deployed to AWS
- **Configuration source:** Local files vs AWS services

---

## CONCLUSION

The use of "local" throughout the project is inconsistent and confusing. The proposed rename to "native" for non-Docker operations will clarify:

- **Native** = Python running directly on the host machine (no Docker)
- **Local** = Operations performed on the dev machine (building, running Docker locally)
- **Docker** = Containerized execution
- **Deployed** = Running in AWS ECS

This will make the codebase much more intuitive to navigate and understand.
