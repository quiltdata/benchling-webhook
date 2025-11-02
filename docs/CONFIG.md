# Benchling Webhook Configuration Guide

## 1. Overview

This document describes the *ideal state* configuration flow for the Benchling Webhook integration. It covers the lifecycle from initial user setup to advanced testing and deployment.

---

## 2. Initial User Setup

### 2.1 Prerequisites

- Node.js ≥ 18
- AWS CLI v2 configured
- Docker installed
- Quilt3 configured (`~/.quilt3/config.yml`)

### 2.2 Bootstrapping

The simplest way to start is by running:

```bash
npx @quiltdata/benchling-webhook
```

This command will:

1. **Infer Quilt catalog URL** from your Quilt3 configuration.
2. **Retrieve the associated CloudFormation Stack ARN** from the catalog’s metadata.
3. **Prompt for essential Benchling parameters**, including:
   - `BENCHLING_TENANT`
   - `BENCHLING_CLIENT_ID`
   - `BENCHLING_CLIENT_SECRET`
   - `BENCHLING_APP_DEFINITION_ID`
4. Write a `.env` file with inferred and user-provided values.
   1. Extending and/or backing up the EXISTING file as needed.

---

## 3. Secrets Management

### 3.1 When to Configure Secrets

- Secrets are injected **after initial environment setup** but **before any deployment**.
- Managed via AWS Secrets Manager.

### 3.2 How to Configure

Use the helper command:

```bash
npm run secrets:sync
```

This uploads your `.env` secrets into Secrets Manager under the stack’s namespace.

**Naming Convention:**
`benchling-webhook/<environment>/<key>`

---

## 4. Docker Image Management

### 4.1 Image Naming

Docker image names follow the pattern:

```
<account-id>.dkr.ecr.<region>.amazonaws.com/benchling-webhook:<version>
```

### 4.2 Version Specification

The version is defined in one of the following:

- `package.json` under `version`
- Or overridden via environment variable `IMAGE_TAG`.

Build and publish with:

```bash
make -C docker build push
```

---

## 5. CloudFormation Parameters

### 5.1 Core Parameters

| Parameter | Description | Default |
|------------|-------------|----------|
| `BenchlingTenant` | Benchling tenant URL | Required |
| `QuiltCatalogUrl` | Quilt catalog endpoint | Auto-inferred |
| `S3Bucket` | User upload bucket | Derived from catalog |
| `SQSQueueArn` | Queue for package creation | Derived from Quilt stack |
| `VpcId` | VPC for Fargate service | Configurable |
| `SubnetIds` | Subnets for ECS tasks | Configurable |

### 5.2 Optional Parameters

| Parameter | Description |
|------------|-------------|
| `ImageTag` | Docker image version override |
| `Cpu` | Task CPU units |
| `Memory` | Task memory allocation |

---

## 6. Environment Variables

### 6.1 Passed from User

| Variable | Purpose |
|-----------|----------|
| `BENCHLING_TENANT` | Benchling instance URL |
| `BENCHLING_CLIENT_ID` | OAuth app client ID |
| `BENCHLING_CLIENT_SECRET` | OAuth app secret |
| `BENCHLING_APP_DEFINITION_ID` | Benchling app definition |

### 6.2 Inferred Automatically

| Variable | Source |
|-----------|---------|
| `QUILT_CATALOG` | From Quilt3 config |
| `QUILT_USER_BUCKET` | From Quilt catalog stack |
| `SQS_QUEUE_URL` | From CloudFormation stack |

---

## 7. Testing Strategy

### 7.1 Local Unit Tests

Run fast tests in isolation:

```bash
npm run test:ts
make -C docker test-unit
```

### 7.2 Local Docker Tests

Integration testing with local containers:

```bash
make -C docker test-local
```

This validates Flask routes and inter-service communication locally.

### 7.3 Remote Docker (ECR) Tests

Validate deployed image builds:

```bash
make -C docker test-ecr
```

Confirms image registry integrity and environment variable injection.

### 7.4 Standalone Stack Tests

Deploy isolated stack for validation:

```bash
npm run cdk:dev
```

Use `/health` and `/health/ready` endpoints to verify.

### 7.5 Integrated Quilt Stack Tests

In end-to-end mode, test package creation flows:

```bash
make -C docker test-integration
```

Ensures Benchling payloads propagate correctly through Quilt S3/SQS integration.

---

## 8. Summary Flow

1. `npx @quiltdata/benchling-webhook`
2. Infer Quilt + AWS stack
3. Prompt for Benchling credentials
4. Upload secrets
5. Build Docker image
6. Deploy via CDK
7. Run integration and E2E tests

---

## 9. Future Enhancements

- Automate stack discovery for multi-tenant Quilt deployments.
- Add `npx` interactive TUI for configuration validation.
- Integrate blue/green deployment pipeline.
