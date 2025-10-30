# Specifications: Fargate-Based Webhook Processing Architecture

## Reference

- **Requirements Document**: `.scratch/119-use-docker/01-requirements.md`
- **Analysis Document**: `.scratch/119-use-docker/02-analysis.md`
- **GitHub Issue**: #119 - "Get rid of the existing lambda, and completely switch the cdk deployment to use Fargate to run the `latest` docker image"

## Executive Summary

This specification defines the target architecture for replacing the current Lambda-based webhook processing system with AWS Fargate containers running the existing Docker Flask application. The new architecture will eliminate all Lambda functions and Step Functions orchestration, replacing them with a containerized solution that handles webhook processing internally through the Python application's built-in workflow orchestration.

## Architectural Goals and Design Principles

### Primary Goals

1. **Complete Lambda Elimination**: Remove all Lambda functions from the CDK stack
2. **Container-First Architecture**: Deploy the existing Docker Flask application on AWS Fargate
3. **Simplified Infrastructure**: Reduce architectural complexity by consolidating processing logic
4. **Direct Integration**: API Gateway routes directly to Application Load Balancer (ALB) backed by Fargate
5. **Internal Orchestration**: Leverage the Python application's existing workflow management

### Design Principles

1. **Stateless Container Design**: Each Fargate task handles requests independently
2. **Horizontal Scalability**: Support auto-scaling based on request volume
3. **High Availability**: Multi-AZ deployment with health-based routing
4. **Observable Systems**: Comprehensive logging and monitoring through CloudWatch
5. **Security by Default**: Least-privilege IAM roles and network isolation

## Desired End State Architecture

### High-Level Architecture

```
Benchling Webhooks → API Gateway → ALB → Fargate Service (Flask App) → AWS Services (S3, SQS)
                                            ↓
                                     Benchling APIs
```

### Core Components

#### 1. API Gateway Configuration

**End State Requirements**:
- Maintain existing REST API with endpoints: `/event`, `/canvas`, `/lifecycle`, `/health`
- Remove Step Functions integration
- Configure HTTP/HTTPS proxy integration to ALB
- Preserve IP allowlist for webhook security
- Pass through all headers and body to ALB

**Success Criteria**:
- All webhook endpoints respond within 30 seconds
- 100% of valid webhook signatures are accepted
- 100% of invalid signatures are rejected
- Health endpoint returns 200 OK when service is available

#### 2. Application Load Balancer (ALB)

**End State Requirements**:
- Internet-facing ALB in public subnets
- Target group pointing to Fargate tasks
- Health checks on `/health/ready` endpoint
- Path-based routing to Fargate service
- SSL/TLS termination at ALB level

**Success Criteria**:
- Zero downtime during deployments
- Health checks detect unhealthy tasks within 30 seconds
- Automatic deregistration of unhealthy targets
- Request distribution across healthy tasks only

#### 3. ECS Fargate Service

**End State Requirements**:
- ECS cluster dedicated to webhook processing
- Fargate service with configurable desired count
- Task definition pulling from ECR: `712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:latest`
- CPU and memory allocation based on workload analysis
- Rolling update deployment strategy

**Success Criteria**:
- Container startup time < 60 seconds
- Graceful shutdown with connection draining
- Automatic task replacement on failure
- Service maintains desired task count

#### 4. Container Configuration

**End State Requirements**:
- Environment variables for AWS region, S3 bucket, SQS queue
- Secrets Manager integration for Benchling credentials
- CloudWatch log driver for container logs
- Health check configuration with appropriate intervals
- Non-root user execution (UID 1000)

**Success Criteria**:
- All configuration externalized from container image
- Secrets never exposed in logs or environment
- Container logs searchable in CloudWatch
- Health checks accurately reflect application state

## Infrastructure Components Specification

### CDK Stack Components

#### 1. VPC and Networking

**Requirements**:
- Use default VPC or create dedicated VPC
- Public subnets for ALB (minimum 2 AZs)
- Private subnets for Fargate tasks (optional)
- NAT gateways if using private subnets
- Security groups with least-privilege rules

**Network Flow**:
- Inbound: Internet → ALB (port 443/80)
- ALB → Fargate (port 5000)
- Outbound: Fargate → Benchling APIs (HTTPS)
- Fargate → AWS Services (S3, SQS)

#### 2. ECS Infrastructure

**Cluster Specification**:
- Cluster name: `benchling-webhook-cluster`
- Container Insights enabled
- Capacity providers: FARGATE and FARGATE_SPOT

**Task Definition**:
- Family: `benchling-webhook-task`
- Network mode: awsvpc
- Requires compatibilities: FARGATE
- CPU: 1024 (1 vCPU) - configurable
- Memory: 2048 (2 GB) - configurable
- Task role: IAM role with S3, SQS permissions
- Execution role: IAM role with ECR, CloudWatch permissions

**Service Configuration**:
- Service name: `benchling-webhook-service`
- Launch type: FARGATE
- Desired count: 2 (minimum for HA)
- Deployment configuration: Rolling update
- Platform version: LATEST

#### 3. Auto-scaling Configuration

**Target Tracking Scaling**:
- Minimum tasks: 2
- Maximum tasks: 10
- Target CPU utilization: 70%
- Target memory utilization: 80%
- Scale-out cooldown: 60 seconds
- Scale-in cooldown: 300 seconds

## IAM Roles and Permissions

### Task Execution Role

**Purpose**: Allow ECS to pull images and write logs

**Required Permissions**:
- `ecr:GetAuthorizationToken`
- `ecr:BatchCheckLayerAvailability`
- `ecr:GetDownloadUrlForLayer`
- `ecr:BatchGetImage`
- `logs:CreateLogStream`
- `logs:PutLogEvents`

### Task Role

**Purpose**: Allow container to access AWS services

**Required Permissions**:
- S3 bucket operations:
  - `s3:GetObject`
  - `s3:PutObject`
  - `s3:ListBucket`
- SQS operations:
  - `sqs:SendMessage`
  - `sqs:GetQueueUrl`
- Secrets Manager:
  - `secretsmanager:GetSecretValue`
- Benchling API credentials access

### ALB Security Group

**Inbound Rules**:
- HTTPS (443) from API Gateway IP ranges
- HTTP (80) from API Gateway IP ranges (redirect to HTTPS)

**Outbound Rules**:
- Port 5000 to Fargate security group

### Fargate Security Group

**Inbound Rules**:
- Port 5000 from ALB security group

**Outbound Rules**:
- HTTPS (443) to 0.0.0.0/0 (Benchling APIs)
- HTTPS (443) to AWS service endpoints

## Integration Strategy

### API Gateway to ALB Integration

**Configuration**:
- Integration type: HTTP_PROXY
- Integration endpoint: ALB DNS name
- Request transformation: Pass-through
- Response transformation: Pass-through
- Timeout: 29 seconds (API Gateway limit)

### Webhook Processing Flow

1. **Webhook Receipt**: API Gateway receives POST request
2. **Request Forwarding**: Proxy to ALB without transformation
3. **Load Balancing**: ALB routes to healthy Fargate task
4. **Signature Verification**: Flask app validates webhook signature
5. **Async Processing**: Python app spawns thread for long-running export
6. **Quick Response**: Return 200 OK to acknowledge webhook
7. **Background Work**: Export processing continues asynchronously
8. **Completion**: Results written to S3, notification to SQS

## Success Criteria and Validation

### Functional Success Criteria

1. **Webhook Processing**:
   - 100% of valid webhooks are processed successfully
   - Export files are correctly downloaded and extracted
   - S3 uploads complete without data loss
   - SQS messages are delivered reliably

2. **Performance Metrics**:
   - Webhook acknowledgment < 5 seconds
   - Container startup < 60 seconds
   - Export processing time comparable to current Lambda
   - Memory utilization < 80% under normal load

3. **Availability Metrics**:
   - 99.9% uptime for webhook endpoints
   - Zero-downtime deployments
   - Automatic recovery from task failures
   - Multi-AZ resilience verified

### Operational Success Criteria

1. **Monitoring and Observability**:
   - All container logs visible in CloudWatch
   - Application metrics available in CloudWatch
   - Failed webhook processing traceable
   - Performance bottlenecks identifiable

2. **Scaling Behavior**:
   - Auto-scaling responds within 2 minutes
   - Scale-out handles traffic spikes
   - Scale-in reduces costs during low traffic
   - No request drops during scaling events

3. **Security Compliance**:
   - No credentials in container logs
   - Network isolation enforced
   - IAM permissions follow least privilege
   - Webhook signatures validated

## Technical Risks and Mitigation

### Risk 1: Long-Running Export Processing

**Risk**: Fargate tasks consumed by long-running exports reduce availability

**Mitigation**:
- Implement worker pool pattern with separate task queue
- Use SQS for decoupling webhook receipt from processing
- Configure appropriate task count and auto-scaling
- Consider timeout limits for export operations

### Risk 2: Container Image Versioning

**Risk**: Using `latest` tag may introduce unexpected changes

**Mitigation**:
- Implement container image scanning
- Create deployment pipeline with staging environment
- Maintain rollback capability
- Consider using specific version tags in production

### Risk 3: Cost Optimization

**Risk**: Fargate costs may exceed Lambda costs for sporadic workloads

**Mitigation**:
- Implement aggressive auto-scaling policies
- Use Fargate Spot for non-critical workloads
- Monitor cost metrics and utilization
- Optimize container size based on actual usage

### Risk 4: Network Latency

**Risk**: Additional network hop through ALB adds latency

**Mitigation**:
- Deploy ALB and Fargate in same AZs
- Use connection pooling for external APIs
- Implement caching where appropriate
- Monitor end-to-end latency metrics

### Risk 5: State Management

**Risk**: Loss of Step Functions visualization and state tracking

**Mitigation**:
- Implement application-level workflow tracking
- Use structured logging for process correlation
- Create CloudWatch dashboards for visibility
- Consider AWS X-Ray for distributed tracing

## Migration Constraints

### What This Specification Excludes

1. **Step Functions**: Complete removal, no hybrid approach
2. **Lambda Functions**: All three Lambda functions eliminated
3. **Backward Compatibility**: No support for parallel Lambda/Fargate operation
4. **Gradual Migration**: Direct cutover approach required

### Dependencies and Prerequisites

1. **Docker Image Availability**: ECR image must be accessible
2. **Python App Readiness**: Flask application must handle all webhooks
3. **Configuration Management**: Environment variables properly set
4. **Network Connectivity**: Outbound HTTPS to Benchling APIs required

## Validation Requirements

### Pre-Deployment Validation

1. **Container Testing**:
   - Local Docker run successful
   - All endpoints respond correctly
   - Export processing completes end-to-end
   - Health checks return appropriate status

2. **Infrastructure Validation**:
   - CDK synth completes without errors
   - IAM roles have required permissions
   - Security groups allow required traffic
   - ALB target group health checks configured

### Post-Deployment Validation

1. **Functional Testing**:
   - Send test webhooks to all endpoints
   - Verify export processing completion
   - Confirm S3 uploads successful
   - Validate SQS message delivery

2. **Performance Testing**:
   - Load test with expected traffic volume
   - Verify auto-scaling triggers
   - Monitor resource utilization
   - Measure end-to-end latency

3. **Resilience Testing**:
   - Kill Fargate tasks and verify recovery
   - Test AZ failure scenarios
   - Verify webhook retry behavior
   - Validate error handling

## Success Metrics

### Key Performance Indicators

1. **Availability**: > 99.9% uptime for webhook endpoints
2. **Latency**: P99 webhook response time < 5 seconds
3. **Throughput**: Support 100 concurrent webhook processing
4. **Error Rate**: < 0.1% failed webhook processing
5. **Cost Efficiency**: Total monthly cost within budget

### Operational Metrics

1. **Deployment Frequency**: Support daily deployments
2. **Recovery Time**: MTTR < 5 minutes for task failures
3. **Scaling Speed**: Scale-out within 2 minutes of trigger
4. **Log Completeness**: 100% of requests traceable
5. **Security Compliance**: Zero security violations

## Architectural Decisions

### Decision 1: No Step Functions

**Choice**: Remove Step Functions entirely

**Rationale**:
- Python application already implements complete workflow
- Reduces architectural complexity
- Eliminates Lambda dependency
- Simplifies debugging and monitoring

### Decision 2: ALB Instead of API Gateway HTTP API

**Choice**: Use Application Load Balancer

**Rationale**:
- Better integration with ECS/Fargate
- Built-in health checking
- Lower latency for high-volume traffic
- Cost-effective for sustained traffic

### Decision 3: Fargate Over EC2

**Choice**: Use Fargate launch type

**Rationale**:
- No infrastructure management required
- Automatic scaling and patching
- Pay-per-use pricing model
- Simplified security model

### Decision 4: Multi-Task Service

**Choice**: Run multiple tasks for high availability

**Rationale**:
- Ensures availability during deployments
- Handles concurrent webhook processing
- Provides resilience against task failures
- Enables zero-downtime updates

## Summary

This specification defines a complete architectural transformation from Lambda/Step Functions to Fargate/ALB. The end state eliminates all Lambda functions, removes Step Functions orchestration, and deploys the existing Docker Flask application on AWS Fargate with proper load balancing, auto-scaling, and high availability. The architecture maintains all current functionality while simplifying operations and improving scalability for large export processing workloads.