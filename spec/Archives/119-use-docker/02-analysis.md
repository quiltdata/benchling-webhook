# Analysis: Migration from Lambda to Fargate for Export Processing

## Reference

Based on requirements from: `spec/119-use-docker/01-requirements.md` (pending creation)

Related GitHub Issue: #119 (assumed)

## Current State Analysis

### 1. Existing Architecture Overview

The benchling-webhook project currently implements a **dual-architecture approach**:

#### 1.1 CDK/Lambda-Based Architecture (TypeScript)

Located in `/lib/` directory:

- **API Gateway** (`lib/api-gateway.ts`)
  - REST API with POST endpoints: `/event`, `/canvas`, `/lifecycle`, `/health`
  - IP-based resource policy for webhook allowlist
  - Direct integration with Step Functions via AWS Integration
  - Request template transforms webhook headers and body to Step Functions input

- **Webhook State Machine** (`lib/webhook-state-machine.ts`)
  - Main orchestration layer using AWS Step Functions
  - Lambda-based webhook verification function (`lib/lambda/verify-webhook.ts`)
  - Handles three workflow paths:
    1. Event channel (entry created/updated)
    2. Canvas channel (canvas created/initialized)
    3. Button interaction channel (user-initiated updates)
  - Delegates to Packaging State Machine for actual processing

- **Packaging State Machine** (`lib/packaging-state-machine.ts`)
  - Nested Step Functions workflow for entry packaging
  - **Lambda Functions**:
    - `ExportProcessor` (`lib/lambda/process-export.ts`): Downloads ZIP from Benchling, extracts, uploads to S3
    - `StringProcessor` (`lib/lambda/process-string.ts`): Generates README template
  - Orchestrates:
    1. Fetch entry data (HTTP Task via EventBridge Connection)
    2. Write templates (Lambda invocation)
    3. Initiate export (HTTP POST to Benchling API)
    4. Poll export status (HTTP GET with wait/retry loop)
    5. Process export (Lambda invocation)
    6. Write metadata to S3 (AWS SDK task)
    7. Send to SQS (AWS SDK task)

- **Infrastructure**:
  - Lambda runtime: Node.js 18, ARM64 architecture
  - Bundling: esbuild with minification
  - Memory: 1024 MB (export processor), 128 MB (string processor)
  - Timeout: 5 minutes (export processor), 1 minute (string processor)
  - IAM: Step Functions role with HTTP invoke, Secrets Manager, EventBridge permissions

#### 1.2 Docker/Python-Based Architecture

Located in `/docker/` directory:

- **Flask Application** (`docker/src/app.py`)
  - HTTP server with endpoints: `/event`, `/lifecycle`, `/canvas`, `/health/*`
  - Webhook signature verification decorator
  - Asynchronous workflow execution using Python threading
  - Canvas management with button interactions and pagination

- **Entry Packager** (`docker/src/entry_packager.py`)
  - **Complete Python workflow orchestration**:
    1. Fetch entry data (Benchling SDK)
    2. Initiate export (Benchling SDK)
    3. Poll export status (30-second intervals, 60 attempts max)
    4. **Process export inline** (download ZIP, extract, upload to S3)
    5. Create metadata files (entry.json, input.json, README.md)
    6. Send to SQS
  - Uses boto3 for AWS operations
  - Implements retry decorators for resilience
  - All processing happens in-process (no Lambda invocations)

- **Infrastructure**:
  - Base image: Python 3.11-slim
  - Package manager: uv for fast dependency installation
  - Non-root user (appuser, UID 1000)
  - Health checks at 30-second intervals
  - Port 5000 exposed
  - Environment-based configuration

- **Current Deployment Model**:
  - Docker Compose for local development
  - ECR repository: `quiltdata/benchling`
  - Manual container deployment (not CDK-managed)
  - Supports local testing with mocked AWS and ngrok tunneling

### 2. Code Idioms and Conventions

#### 2.1 TypeScript/CDK Conventions

- **File Organization**:
  - Construct classes in `lib/` with descriptive names
  - Lambda handlers in `lib/lambda/` subdirectory
  - Types in `lib/types.ts`
  - Constants in `lib/constants.ts`

- **CDK Patterns**:
  - Construct composition (WebhookStateMachine contains PackagingStateMachine)
  - Custom states for HTTP invocations using EventBridge connections
  - Pass states for data transformation
  - Choice states for workflow branching
  - Task result paths for state accumulation

- **Lambda Patterns**:
  - NodejsFunction with esbuild bundling
  - ARM64 architecture for cost optimization
  - External modules list for SDK optimization
  - Environment variable configuration
  - Typed event interfaces

#### 2.2 Python/Docker Conventions

- **Code Organization**:
  - Modular architecture with single-responsibility modules
  - Structured logging with structlog
  - Configuration through environment variables
  - Separation of concerns (payload parsing, canvas management, entry packaging)

- **Python Patterns**:
  - Dataclass-based models
  - Decorator-based retry logic
  - Context managers for resource cleanup
  - Threading for async execution
  - Custom JSON encoders for datetime serialization

- **Testing Patterns**:
  - Pytest with markers (unit, integration, local)
  - Mock-based testing with pytest-mock
  - Makefile commands for different test scenarios

### 3. Current System Constraints and Limitations

#### 3.1 Lambda-Based Architecture Constraints

1. **Lambda Execution Limits**:
   - 15-minute maximum execution time
   - 10 GB maximum memory
   - 512 MB `/tmp` storage
   - Cold start latency for infrequent invocations

2. **Lambda Packaging Constraints**:
   - 250 MB deployment package (unzipped)
   - 50 MB deployment package (zipped)
   - Complex dependency management with external modules

3. **Step Functions Integration**:
   - Step Functions Standard execution limit: 1 year (not a practical constraint)
   - HTTP Task requires EventBridge Connection for OAuth
   - Request/Response pattern requires synchronous Lambda execution
   - State machine complexity increases debugging difficulty

4. **Current Lambda Usage**:
   - **ExportProcessor**: Downloads and processes Benchling export ZIP files
     - Potential size constraints with large exports
     - Memory pressure with large ZIP files
     - Limited /tmp space for extraction
   - **StringProcessor**: Simple template generation
     - Could be replaced with Step Functions intrinsic functions
   - **VerificationFunction**: Webhook signature verification
     - Required for security but adds latency

#### 3.2 Docker-Based Architecture Current State

1. **Deployment Gap**:
   - Docker image exists and is functional
   - No CDK infrastructure for Fargate deployment
   - No ECS cluster, task definition, or service defined
   - Manual deployment and scaling

2. **Operational Limitations**:
   - No integrated monitoring (CloudWatch Logs, X-Ray)
   - No auto-scaling configuration
   - No health check integration with load balancer
   - No blue/green deployment strategy

3. **Consistency Issues**:
   - Python implementation diverged from Step Functions workflow
   - Different retry strategies and error handling
   - Separate configuration management
   - Version synchronization manual process

### 4. Architectural Challenges and Design Considerations

#### 4.1 Export Processing Challenges

1. **Large File Processing**:
   - Benchling exports can be arbitrarily large
   - Lambda /tmp storage limited to 512 MB
   - Fargate ephemeral storage configurable (20-200 GB)
   - Memory can be allocated up to 120 GB in Fargate

2. **Processing Time**:
   - Export polling can take 30+ minutes for large entries
   - Lambda 15-minute timeout is insufficient for long-running exports
   - Current Step Functions implementation uses wait states (acceptable)
   - Python implementation uses blocking poll (blocks thread for duration)

3. **Concurrency and Rate Limiting**:
   - Multiple webhooks could trigger concurrent exports
   - Benchling API rate limits apply
   - Lambda concurrency limits (default 1000, burst 500-3000)
   - Fargate task limits (configurable, typically higher)

#### 4.2 Integration Challenges

1. **API Gateway to Fargate**:
   - Current API Gateway → Step Functions integration is direct
   - Fargate requires ALB or API Gateway HTTP API integration
   - Network configuration (VPC, subnets, security groups)
   - Service discovery or static target groups

2. **State Management**:
   - Step Functions provides state persistence and visualization
   - Fargate requires application-level state management
   - Webhook acknowledgment vs. long-running processing
   - Status polling and monitoring

3. **OAuth and Authentication**:
   - Step Functions uses EventBridge Connection for Benchling OAuth
   - Python implementation uses Benchling SDK with client credentials
   - Both approaches work but have different token management

4. **Error Handling and Retries**:
   - Step Functions has built-in retry and catch mechanisms
   - Python implementation uses decorator-based retries
   - Different visibility into failure states

#### 4.3 Migration Complexity

1. **Dual Architecture Maintenance**:
   - Current Docker implementation is **already functional**
   - Migration would create **parallel systems** during transition
   - Need to decide: replace or supplement Lambda approach

2. **Feature Parity**:
   - Step Functions workflow has mature canvas integration
   - Python implementation has advanced canvas features (pagination, browsing)
   - README template generation differs between implementations
   - Metadata structure has evolved independently

3. **Testing and Validation**:
   - Extensive tests exist for Lambda/Step Functions
   - Python tests focus on integration and local execution
   - Need comprehensive testing strategy for Fargate deployment

4. **Deployment Complexity**:
   - Adding Fargate infrastructure to CDK increases deployment complexity
   - Container image build and push pipeline required
   - ECR repository management
   - Task definition versioning and rollback

### 5. Gap Analysis

#### 5.1 Infrastructure Gaps

**Missing CDK Constructs**:
- ECS Cluster definition
- Fargate Task Definition with container configuration
- ECS Service with desired count and scaling policies
- Application Load Balancer (ALB) or API Gateway HTTP API integration
- VPC networking (or use of default VPC)
- Security groups for task and ALB
- IAM task execution role and task role
- CloudWatch Log Groups for container logs
- Service discovery (optional, for internal communication)

**Missing CI/CD Integration**:
- Automated Docker build on code changes
- ECR image lifecycle policies
- Container scanning for vulnerabilities
- Deployment pipeline (CodePipeline or GitHub Actions)

#### 5.2 Application Gaps

**Python Application Readiness**:
- Application is production-ready (Flask + Gunicorn pattern needed)
- Health check endpoints implemented (`/health`, `/health/ready`, `/health/live`)
- Configuration via environment variables
- Graceful shutdown handling (may need enhancement)

**Monitoring and Observability**:
- Structured logging exists (structlog)
- Need CloudWatch Logs integration
- Need X-Ray tracing integration (optional)
- Need application metrics (custom metrics or CloudWatch EMF)

**Security Enhancements**:
- Non-root container user exists
- Secrets management (currently uses environment variables)
- Should migrate to AWS Secrets Manager or Parameter Store
- Network security (security groups, NACLs)

#### 5.3 Operational Gaps

**Scaling and Performance**:
- No auto-scaling policies defined
- No target tracking metrics defined
- No load testing baseline
- Unknown optimal task count and resource allocation

**High Availability**:
- No multi-AZ deployment strategy
- No health check grace period tuning
- No circuit breaker or backoff strategy

**Cost Management**:
- No cost analysis Lambda vs. Fargate
- No resource utilization monitoring
- No spot instance usage strategy

### 6. Current Code Structure for Migration

#### 6.1 Lambda Functions to Replace/Migrate

1. **ExportProcessor** (`lib/lambda/process-export.ts`):
   - **Function**: Downloads ZIP, extracts, uploads to S3
   - **Migration**: Functionality exists in `docker/src/entry_packager.py::_process_export()`
   - **Challenge**: Currently invoked from Step Functions; would need to be part of Fargate task

2. **StringProcessor** (`lib/lambda/process-string.ts`):
   - **Function**: Generates README.md template
   - **Migration**: Functionality exists in README template generation
   - **Challenge**: Simple enough to keep as Lambda or move to Fargate

3. **WebhookVerificationFunction** (`lib/lambda/verify-webhook.ts`):
   - **Function**: Verifies webhook signatures
   - **Migration**: Functionality exists in `docker/src/webhook_verification.py`
   - **Challenge**: Should stay as API Gateway request validator or move to Fargate

#### 6.2 Docker Application Structure

**Strengths**:
- Complete workflow implementation in `entry_packager.py`
- Canvas management with advanced features
- Webhook verification integrated
- Health check endpoints
- Structured logging

**Weaknesses**:
- Background threading for async execution (not ideal for container orchestration)
- No WSGI server configured (needs Gunicorn)
- No distributed state management
- Inline processing blocks worker threads

### 7. Challenges Summary

#### 7.1 Technical Challenges

1. **Workflow Orchestration**:
   - Step Functions provides visual workflow, retry, and error handling
   - Moving to Fargate means application-level orchestration
   - Need to decide: keep Step Functions orchestrating Fargate tasks OR move to pure Fargate

2. **Webhook Response Time**:
   - Webhooks should respond quickly (< 30 seconds)
   - Long-running export processing (30+ minutes) needs async pattern
   - Current Step Functions handles this well
   - Fargate needs background job pattern (SQS + worker tasks?)

3. **Stateful vs. Stateless**:
   - Current Lambda functions are stateless
   - Fargate tasks can be stateful but shouldn't be for scalability
   - Need external state storage for workflow tracking

#### 7.2 Operational Challenges

1. **Deployment Coordination**:
   - CDK manages Lambda deployment automatically
   - Fargate requires container build, push, and task definition update
   - Need CI/CD pipeline integration

2. **Debugging and Troubleshooting**:
   - Step Functions provides execution history and visualization
   - Fargate requires application-level logging and tracing
   - Need CloudWatch Insights queries and dashboards

3. **Cost Optimization**:
   - Lambda costs based on execution time and memory
   - Fargate costs based on vCPU and memory reservation over time
   - Need analysis of actual usage patterns

#### 7.3 Migration Strategy Challenges

1. **Incremental vs. Big Bang**:
   - Can't easily run both Lambda and Fargate in parallel (API Gateway limitation)
   - Could route by endpoint or feature flag
   - Rollback strategy needed

2. **Data Consistency**:
   - Both implementations write to same S3 bucket and SQS queue
   - Need to ensure metadata format consistency
   - Need to handle in-flight workflows during migration

3. **Testing Strategy**:
   - Need integration tests that work with both architectures
   - Need load testing to validate Fargate performance
   - Need shadow traffic or canary deployment

## Summary

The current architecture has **two parallel implementations**:

1. **CDK/Lambda/Step Functions** (TypeScript): Mature, deployed, with visual workflow
2. **Docker/Python/Flask** (Python): Functional, feature-rich, but not CDK-deployed

The Docker implementation **already contains the core functionality** needed to replace Lambda processing, but it requires:

- CDK infrastructure for Fargate deployment
- Integration with existing API Gateway
- Decisions about workflow orchestration (keep Step Functions or move to application-level)
- Deployment pipeline and monitoring
- Migration strategy to ensure zero downtime

The primary challenge is **not technical feasibility** (Python app works) but **operational complexity** and **architectural decisions** about how to orchestrate workflows without Step Functions.

## Next Steps

Before proceeding to specifications (Step 3), the following questions need answers:

1. **Orchestration Model**: Keep Step Functions orchestrating Fargate tasks, or move to pure Fargate with application-level workflow?
2. **Migration Strategy**: Incremental (feature-by-feature) or complete replacement?
3. **Hybrid Approach**: Use Fargate for export processing but keep Lambda for lightweight tasks?
4. **Cost-Benefit Analysis**: What are actual Lambda costs vs. projected Fargate costs?
5. **Performance Requirements**: What are acceptable latency and throughput targets?
