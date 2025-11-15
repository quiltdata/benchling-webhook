# Requirements Document

## GitHub Issue Reference

**Issue Number**: #119
**Issue Title**: use docker
**Branch**: 119-use-docker

## Problem Statement

The current Benchling webhook processor deployment uses AWS Lambda functions for processing export operations. The goal is to completely replace the Lambda-based architecture with AWS Fargate containers running the pre-built Docker image from the ECR registry. This will align the deployment with the containerized approach and simplify the architecture by using the same Docker image that is already being built and published.

## User Stories

### Story 1: Deploy with Docker Container
**As a** DevOps engineer
**I want** to deploy the Benchling webhook processor using the Docker image from ECR
**So that** I can leverage the existing containerized distribution and maintain consistency across deployment environments

### Story 2: Process Exports via Fargate
**As a** system operator
**I want** the export processing to run in Fargate containers
**So that** I can benefit from better resource management, scaling, and operational visibility compared to Lambda functions

### Story 3: Remove Lambda Dependencies
**As a** developer maintaining the codebase
**I want** to eliminate the Lambda function code and infrastructure
**So that** the codebase is simplified and we have a single deployment model to maintain

### Story 4: Preserve Existing Functionality
**As an** end user of the Benchling integration
**I want** all existing webhook processing functionality to continue working
**So that** my workflows are not disrupted by the infrastructure change

### Story 5: Maintain State Machine Orchestration
**As a** system architect
**I want** the Step Functions state machine to continue orchestrating the workflow
**So that** we preserve the existing integration points with API Gateway, S3, SQS, and Benchling APIs

## Acceptance Criteria

### AC1: Fargate Task Definition
1. Create ECS Fargate task definition that uses the Docker image from ECR
2. Configure task to pull from: `712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:latest`
3. Ensure proper IAM roles and permissions for ECR image pull
4. Configure appropriate CPU and memory allocation for the container

### AC2: Step Functions Integration
1. Replace Lambda invocation tasks with ECS RunTask integrations in the state machine
2. Maintain the same input/output contract for the export processing step
3. Preserve all existing state machine workflow paths (canvas, button, event)
4. Ensure proper error handling and retry logic for Fargate tasks

### AC3: Lambda Removal
1. Remove the Lambda function definition for `process-export.ts` from CDK stack
2. Remove the Lambda function definition for `process-string.ts` from CDK stack
3. Remove Lambda-specific bundling configuration
4. Update PackagingStateMachine construct to use Fargate instead of Lambda

### AC4: IAM and Networking
1. Create appropriate IAM roles for Fargate tasks with S3 access permissions
2. Configure VPC networking for Fargate tasks (or use public subnet with proper security)
3. Grant Fargate task role permissions to read from S3 bucket
4. Grant Fargate task role permissions to write to S3 bucket

### AC5: Docker Image Configuration
1. Use the `latest` tag from the specified ECR repository
2. Ensure container can access required environment variables or configuration
3. Verify container has necessary AWS SDK clients for S3 operations
4. Configure proper logging for container stdout/stderr to CloudWatch

### AC6: Functionality Preservation
1. Export download and processing continues to work end-to-end
2. ZIP file extraction and S3 upload functionality remains intact
3. String processing for README generation continues to work
4. All integration tests pass with the new architecture

### AC7: Deployment Success
1. CDK synthesis completes without errors
2. CDK deployment succeeds in target AWS account
3. Stack update does not break existing Step Functions executions
4. CloudFormation parameters remain functional

### AC8: Operational Readiness
1. CloudWatch logs capture container output
2. Failed task executions are visible and debuggable
3. Fargate task metrics are available in CloudWatch
4. Documentation is updated to reflect the new architecture

## High-Level Implementation Approach

The implementation will involve modifying the CDK infrastructure to replace Lambda-based processing with Fargate container tasks:

1. **Infrastructure Changes**: Update the `PackagingStateMachine` construct to define ECS Fargate tasks instead of Lambda functions, including task definitions, cluster configuration, and IAM roles

2. **State Machine Updates**: Modify the Step Functions definition to invoke Fargate tasks using the ECS RunTask integration pattern instead of Lambda invocation tasks

3. **Image Configuration**: Configure the Fargate task definition to pull the Docker image from the specified ECR registry with appropriate authentication and permissions

4. **Code Cleanup**: Remove Lambda function code and related build configuration that is no longer needed in the CDK stack

5. **Testing Strategy**: Validate that the existing acceptance tests continue to pass with the new container-based architecture, ensuring functional equivalence

## Success Metrics

### Metric 1: Deployment Efficiency
- CDK deployment time for stack updates
- Container startup time compared to Lambda cold start
- Time from webhook receipt to completion

### Metric 2: Operational Metrics
- Container memory utilization
- Container CPU utilization
- Task failure rate compared to Lambda failure rate

### Metric 3: Cost Metrics
- Cost per webhook processing execution
- Cost comparison between Lambda and Fargate approaches
- Resource utilization efficiency

### Metric 4: Reliability Metrics
- Successful webhook processing rate (should be 100% for valid requests)
- Error rate and error types
- State machine execution success rate

## Open Questions

### Question 1: Container Interface Contract
**Question**: What is the expected interface between the Fargate container and Step Functions? Does the Docker image expose an HTTP endpoint, or does it run as a batch job with parameters passed via environment variables or command line arguments?

**Context**: The Lambda functions currently use specific handler signatures. We need to understand how the Docker container is designed to receive input and return output.

### Question 2: Docker Image Contents
**Question**: What functionality does the existing Docker image provide? Does it already implement the export processing logic, or will we need to adapt it?

**Context**: The current Lambda handles downloading ZIP files from Benchling, extracting contents, and uploading to S3. We need to confirm the Docker image provides equivalent functionality.

### Question 3: Networking Requirements
**Question**: Does the Fargate task need to make outbound requests to Benchling APIs, or is all Benchling communication handled by the Step Functions HTTP tasks?

**Context**: This affects VPC configuration and security group rules for the Fargate tasks.

### Question 4: State and Concurrency
**Question**: How should we handle concurrent webhook processing? Should each webhook trigger a separate Fargate task, or should there be a long-running service?

**Context**: Lambda automatically handles concurrency. With Fargate, we need to design the concurrency model explicitly.

### Question 5: Migration Strategy
**Question**: Should we maintain backward compatibility during migration, or is a clean cutover acceptable?

**Context**: This affects whether we need to support both Lambda and Fargate approaches temporarily or can remove Lambda code immediately.

### Question 6: String Processing
**Question**: Does the Docker image also handle the string processing functionality (README template generation), or will this need separate handling?

**Context**: Currently there are two Lambda functions: `process-export` and `process-string`. We need to understand if the Docker image replaces one or both.

## Related Issues and Dependencies

- The Docker image build and publish process is already established (as evidenced by `bin/docker.js`)
- The current CDK stack uses Lambda functions defined in `lib/lambda/process-export.ts` and `lib/lambda/process-string.ts`
- The `PackagingStateMachine` construct orchestrates these Lambda functions via Step Functions
- Existing IAM roles and policies will need to be adapted for Fargate task execution

## Technical Context

### Current Architecture Components
- **API Gateway**: Receives webhook events from Benchling
- **Step Functions**: Orchestrates workflow with multiple state machines (WebhookStateMachine, PackagingStateMachine)
- **Lambda Functions**: Process exports (`process-export.ts`) and strings (`process-string.ts`)
- **S3**: Stores processed files and entry data
- **SQS**: Receives notifications for the Quilt Packaging Engine
- **EventBridge**: Manages OAuth connection to Benchling APIs

### Docker Image Details
- **Registry**: 712023778557.dkr.ecr.us-east-1.amazonaws.com
- **Repository**: quiltdata/benchling
- **Tag**: latest (also available: 0.3.2, 0.4.7)
- **Platform**: linux/amd64
- **Size**: 123.79 MB

### Key Files
- `/Users/ernest/GitHub/benchling-webhook/lib/packaging-state-machine.ts`: Defines Lambda-based processing workflow
- `/Users/ernest/GitHub/benchling-webhook/lib/lambda/process-export.ts`: Lambda handler for export processing
- `/Users/ernest/GitHub/benchling-webhook/lib/lambda/process-string.ts`: Lambda handler for string processing
- `/Users/ernest/GitHub/benchling-webhook/lib/benchling-webhook-stack.ts`: Main CDK stack definition
- `/Users/ernest/GitHub/benchling-webhook/bin/docker.js`: Docker build and publish automation
