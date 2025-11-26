# BenchlingWebhookStack Log Resources - Standalone Deployment

## Overview

This document catalogs ALL loggable resources in the `BenchlingWebhookStack` deployed in `us-east-1` region (account `712023778557`).

**Deployment Details:**
- Stack Name: `BenchlingWebhookStack`
- Region: `us-east-1`
- Account: `712023778557`
- Deployment Date: 2025-11-16T08:13:19Z
- Architecture: API Gateway → ALB → ECS Fargate (2 tasks)

## CloudWatch Log Groups

### 1. Main ECS Container Logs

**Log Group:** `BenchlingWebhookStack`

| Property | Value |
|----------|-------|
| ARN | `arn:aws:logs:us-east-1:712023778557:log-group:BenchlingWebhookStack:*` |
| Created | 2025-11-16T08:13:19Z |
| Retention | 7 days |
| Stored Bytes | 17,834,883 (~17 MB) |
| Total Streams | 325 |
| Metric Filters | 0 |

**Log Stream Naming:**
```
benchling-webhook/BenchlingWebhookContainer/{taskId}
```

**Active Streams (Current Tasks):**
- `benchling-webhook/BenchlingWebhookContainer/97a3410cff544a03ac613eed375554cb`
- `benchling-webhook/BenchlingWebhookContainer/b2f37e50067440ffb05d1b1b143b4534`

**Container Configuration:**
```json
{
  "logDriver": "awslogs",
  "options": {
    "awslogs-group": "BenchlingWebhookStack",
    "awslogs-region": "us-east-1",
    "awslogs-stream-prefix": "benchling-webhook"
  }
}
```

**Content Types:**
- Flask application logs (werkzeug)
- Health check requests (`/health`, `/health/ready`)
- Webhook processing logs
- Python application errors/warnings

**Current Activity:**
- 2 running tasks generating logs continuously
- ~6-8 health check requests per minute per task
- 325 historical streams from previous task restarts/deployments

### 2. API Gateway Access Logs

**Log Group:** `/aws/apigateway/benchling-webhook`

| Property | Value |
|----------|-------|
| Created | Unknown (not in stack resources) |
| Retention | 7 days |
| Stored Bytes | 0 |
| Purpose | HTTP access logs from API Gateway |

**Configuration:**
```json
{
  "format": "$context.identity.sourceIp $context.identity.caller $context.identity.user [$context.requestTime] \"$context.httpMethod $context.resourcePath $context.protocol\" $context.status $context.responseLength $context.requestId",
  "destinationArn": "arn:aws:logs:us-east-1:712023778557:log-group:/aws/apigateway/benchling-webhook"
}
```

**Note:** Currently showing 0 bytes, suggesting:
- No traffic through API Gateway in retention window
- Access logging may not be fully enabled
- Logs may have expired (7-day retention)

### 3. API Gateway Execution Logs

**Status:** NOT ENABLED

- No execution log group found
- Stage `prod` does not have execution logging enabled
- Would be named: `/aws/apigateway/execution-logs_141osw4nkd/prod`

**To Enable:**
```bash
aws apigateway update-stage \
  --rest-api-id 141osw4nkd \
  --stage-name prod \
  --patch-operations op=replace,path=/*/*/logging/loglevel,value=INFO
```

### 4. ECS Container Insights Performance Logs

**Log Group:** `/aws/ecs/containerinsights/benchling-webhook-cluster/performance`

| Property | Value |
|----------|-------|
| Created | Unknown |
| Retention | 1 day |
| Stored Bytes | 3,297,954 (~3.1 MB) |
| Purpose | ECS task/container performance metrics |

**Metrics Included:**
- CPU utilization
- Memory utilization
- Network I/O
- Storage I/O
- Task-level performance data

**Note:** Container Insights is ENABLED for the cluster.

### 5. Lambda Custom Resource Logs

**Purpose:** CDK Custom Resources (S3 auto-delete, etc.)

**Current Lambda Functions:**
- `/aws/lambda/BenchlingWebhookStack-CustomS3AutoDeleteObjectsCus-1oiT7VNPcXPt` (1,055 bytes)
- `/aws/lambda/BenchlingWebhookStack-CustomS3AutoDeleteObjectsCus-V8Tutfo7YQlS` (2,440 bytes)
- `/aws/lambda/BenchlingWebhookStack-CustomS3AutoDeleteObjectsCus-mgOI1BezzKJx` (2,161 bytes)
- `/aws/lambda/BenchlingWebhookStack-CustomS3AutoDeleteObjectsCus-q2T1s1MyeR1d` (2,149 bytes)
- `/aws/lambda/BenchlingWebhookStack-CustomS3AutoDeleteObjectsCus-tINc0AxoPw0n` (2,446 bytes)

**Retention:** Never expires

**Note:** Multiple Lambda functions suggest stack has been redeployed multiple times. Old Lambda logs persist.

### 6. State Machine Logs (Legacy/Unused?)

**Log Groups:**
- `BenchlingWebhookStack-StateMachineLogs3CB16D3C-TSs503aE9DZY` (0 bytes, 731-day retention)
- `BenchlingWebhookStack-StateMachineLogs3CB16D3C-Zhpopnpd1iuu` (319,014 bytes, 731-day retention)

**Lambda Functions (State Machine Related):**
- `/aws/lambda/BenchlingWebhookStack-StateMachinePackagingExportP-iYm14kDCXyie` (54,230 bytes)
- `/aws/lambda/BenchlingWebhookStack-StateMachinePackagingStringP-kKOfUidlP1zq` (15,660 bytes)
- `/aws/lambda/BenchlingWebhookStack-StateMachineWebhookVerificat-Lx0Yb7xF3t8y` (56,879 bytes)

**Note:** These appear to be from an older architecture. Current logs show direct webhook processing without Step Functions.

### 7. Legacy API Gateway Log Groups

**Log Group:** `BenchlingWebhookStack-ApiGatewayAccessLogsFB871B4C-drQ0OGrx3Gte`

| Property | Value |
|----------|-------|
| Created | 2025-10-15T19:40:33Z |
| Retention | 731 days (2 years) |
| Stored Bytes | 0 |
| Status | Likely from previous deployment |

**Note:** Physical resource ID suggests this is from an older stack iteration.

## Application Load Balancer (ALB) Logs

### S3 Access Logs

**Bucket:** `benchling-webhook-alb-logs-712023778557`

**Configuration:**
```
access_logs.s3.enabled=true
access_logs.s3.bucket=benchling-webhook-alb-logs-712023778557
access_logs.s3.prefix=alb-access-logs
```

**Log Format:** Gzip-compressed files per 5-minute interval

**Path Structure:**
```
s3://benchling-webhook-alb-logs-712023778557/alb-access-logs/
  AWSLogs/
    712023778557/
      elasticloadbalancing/
        us-east-1/
          2025/11/25/
            712023778557_elasticloadbalancing_us-east-1_app.benchling-webhook-alb.bb4d43d059891020_20251125T2325Z_34.204.240.248_leifokio.log.gz
```

**Recent Activity (Last 10 files):**
- 2025-11-25 13:35:11 - 441 bytes
- 2025-11-25 13:40:04 - 383 bytes
- 2025-11-25 13:55:04 - 360 bytes
- 2025-11-25 14:05:04 - 458 bytes
- 2025-11-25 14:30:04 - 370 bytes
- 2025-11-25 14:35:04 - 342 bytes
- 2025-11-25 15:00:05 - 439 bytes
- 2025-11-25 15:00:11 - 840 bytes
- 2025-11-25 15:20:11 - 455 bytes
- 2025-11-25 15:25:05 - 448 bytes

**Content:** HTTP access logs including:
- Request timestamps
- Client IP addresses
- Request methods and paths
- Response status codes
- Response times
- Target health

**Note:** ALB logs are in S3, NOT CloudWatch Logs. Tools must support S3 log parsing.

### ALB Health Check Logs

**Status:** NOT ENABLED

```
health_check_logs.s3.enabled=false
connection_logs.s3.enabled=false
```

## Stack Resources with Potential Logging

### ECS Service

**Cluster:** `benchling-webhook-cluster`
**Service:** `benchling-webhook-service`
**Task Definition:** `benchling-webhook-task:61` (revision 61)

**Current State:**
- Status: ACTIVE
- Desired Count: 2
- Running Count: 2
- Launch Type: FARGATE

**Running Tasks:**
- `arn:aws:ecs:us-east-1:712023778557:task/benchling-webhook-cluster/97a3410cff544a03ac613eed375554cb`
- `arn:aws:ecs:us-east-1:712023778557:task/benchling-webhook-cluster/b2f37e50067440ffb05d1b1b143b4534`

**Container:** `BenchlingWebhookContainer`

**Logs to:** `BenchlingWebhookStack` log group with prefix `benchling-webhook/`

### API Gateway

**API Name:** `BenchlingWebhookAPI`
**API ID:** `141osw4nkd`
**Type:** REST API (EDGE)
**Stage:** `prod`

**Endpoints:**
- `https://141osw4nkd.execute-api.us-east-1.amazonaws.com/prod/` (root)
- `https://141osw4nkd.execute-api.us-east-1.amazonaws.com/prod/{proxy+}` (wildcard)

**Logging:**
- ✅ Access logs enabled → `/aws/apigateway/benchling-webhook`
- ❌ Execution logs NOT enabled

**Integration:** HTTP_PROXY to ALB

### Application Load Balancer

**Name:** `benchling-webhook-alb`
**ARN:** `arn:aws:elasticloadbalancing:us-east-1:712023778557:loadbalancer/app/benchling-webhook-alb/bb4d43d059891020`
**DNS:** `benchling-webhook-alb-325296743.us-east-1.elb.amazonaws.com`
**State:** Active
**Scheme:** Internet-facing

**Target Group:** `Benchl-Farga-UIZGCRDTALF5`
**Health Check:** `/health` endpoint

**Logging:**
- ✅ Access logs enabled → S3
- ❌ Health check logs NOT enabled
- ❌ Connection logs NOT enabled

## Log Volume Analysis

### Total Storage (CloudWatch Only)

| Log Group | Stored Bytes | Retention |
|-----------|--------------|-----------|
| ECS Container Logs | 17,834,883 | 7 days |
| Container Insights | 3,297,954 | 1 day |
| State Machine Logs | 319,014 | 731 days |
| Lambda Custom Resources | ~15,000 | Never |
| Lambda State Machines | ~126,769 | Never |
| API Gateway Access | 0 | 7 days |
| **Total CloudWatch** | **~21.5 MB** | - |

**Note:** ALB S3 logs not included in CloudWatch totals.

### Log Stream Growth

**ECS Container Logs:**
- 325 total streams (historical + current)
- 2 active streams (current tasks)
- Average: ~55 KB per stream
- Growth rate: ~2-3 new streams per deployment

**Stream Lifecycle:**
- New stream created when task starts
- Stream persists after task stops
- Streams age out after 7-day retention
- Empty streams (0 bytes) indicate task started but never logged

## Current Logging Gaps

### ❌ Missing/Disabled

1. **API Gateway Execution Logs**
   - Not enabled on stage `prod`
   - Would provide request/response debugging
   - Would show integration latency

2. **ALB Health Check Logs**
   - Disabled in ALB attributes
   - Would help debug target health issues

3. **ALB Connection Logs**
   - Disabled in ALB attributes
   - Would show TLS handshake details

4. **CloudWatch Metrics**
   - Not explicitly configured in stack
   - Relying on default ECS/ALB metrics

5. **Application-Level Structured Logging**
   - Current logs are werkzeug default format
   - No JSON structured logging
   - No correlation IDs
   - No request tracing

### ✅ Enabled

1. **ECS Container Logs** → CloudWatch
2. **API Gateway Access Logs** → CloudWatch
3. **ALB Access Logs** → S3
4. **ECS Container Insights** → CloudWatch

## Log Stream Naming Patterns

### Current Implementation

**ECS Task Logs:**
```
benchling-webhook/BenchlingWebhookContainer/{taskId}
```

**Example:**
```
benchling-webhook/BenchlingWebhookContainer/97a3410cff544a03ac613eed375554cb
```

**Task ID Format:**
- 32-character hexadecimal
- Unique per task instance
- Not human-readable
- No timestamp information

### Observed Issues

1. **No Task Metadata in Stream Name**
   - Cannot determine task start time from name
   - Cannot distinguish task versions/deployments
   - Hard to correlate with ECS API

2. **Empty Streams**
   - Many streams with 0 bytes
   - Suggests tasks started but didn't log
   - Could be failed health checks or rapid restarts
   - Clutters stream list

3. **No Stream Prefix Filtering**
   - All streams have same prefix
   - Cannot filter by deployment or version
   - No way to distinguish prod vs test tasks

## Access Patterns

### CLI Access (Current Tools)

**AWS CLI (CloudWatch Logs):**
```bash
# Tail recent logs
aws logs tail "BenchlingWebhookStack" --region us-east-1 --since 1h --follow

# Filter by stream prefix
aws logs filter-log-events \
  --log-group-name "BenchlingWebhookStack" \
  --log-stream-name-prefix "benchling-webhook/" \
  --start-time 1764110902000 \
  --region us-east-1

# Describe streams
aws logs describe-log-streams \
  --log-group-name "BenchlingWebhookStack" \
  --region us-east-1 \
  --order-by LastEventTime \
  --descending
```

**AWS CLI (ALB Logs):**
```bash
# List ALB log files
aws s3 ls s3://benchling-webhook-alb-logs-712023778557/alb-access-logs/ \
  --recursive

# Download recent logs
aws s3 cp s3://benchling-webhook-alb-logs-712023778557/alb-access-logs/... \
  - | gunzip
```

### CLI Access (Benchling Webhook Tool)

**Current Command:**
```bash
benchling-webhook logs --profile default --region us-east-1
```

**Implementation:**
- Uses `FilterLogEventsCommand` API
- Queries `BenchlingWebhookStack` log group
- Filters by `benchling-webhook/` prefix
- Currently experiencing performance issues (see [01-log-status.md](01-log-status.md))

## Recommended Log Access Strategy

### For Real-Time Debugging

**Primary:** ECS Container Logs (CloudWatch)
- Fastest access (streaming)
- Contains application logs
- Includes Python exceptions

**Command:**
```bash
aws logs tail "BenchlingWebhookStack" \
  --region us-east-1 \
  --filter-pattern "benchling-webhook/" \
  --follow
```

### For Request Analysis

**Primary:** ALB Access Logs (S3)
- Complete HTTP request/response data
- Response times and status codes
- Client IP addresses

**Secondary:** API Gateway Access Logs (CloudWatch)
- Request routing information
- API Gateway latency
- IP filtering results

### For Performance Troubleshooting

**Primary:** Container Insights (CloudWatch)
- CPU/memory per task
- Network I/O patterns
- Resource bottlenecks

**Query with CloudWatch Insights:**
```sql
fields @timestamp, TaskId, CpuUtilized, MemoryUtilized
| filter ServiceName = "benchling-webhook-service"
| sort @timestamp desc
```

### For Cost Analysis

**Primary:** CloudWatch Logs Storage Metrics
- Log group size over time
- Ingestion volume
- Retention costs

**Query:**
```bash
aws logs describe-log-groups \
  --log-group-name-prefix "BenchlingWebhookStack" \
  --query 'logGroups[*].[logGroupName, storedBytes]'
```

## Log Retention Summary

| Log Type | Retention | Rationale |
|----------|-----------|-----------|
| ECS Container Logs | 7 days | Development/debugging |
| Container Insights | 1 day | Metrics only |
| API Gateway Access | 7 days | Short-term debugging |
| ALB Access Logs | Unknown | S3 lifecycle policy |
| Lambda Logs | Never | CDK default |
| State Machine Logs | 731 days | Historical/compliance |

**Cost Optimization Opportunity:**
- Lambda custom resource logs can be reduced to 7 days
- State machine logs may be obsolete (verify architecture)
- Container Insights could be reduced to 1 day if cost-sensitive

## Integration Points for Log Tooling

### CloudWatch Logs API

**Endpoints Used:**
- `DescribeLogGroups` - List available log groups
- `DescribeLogStreams` - List streams in group
- `FilterLogEvents` - Query logs with pattern
- `GetLogEvents` - Get logs from specific stream

**Rate Limits:**
- 5 transactions per second per account per region
- Throttling returns `ThrottlingException`

**Current Issues (see [01-log-status.md](01-log-status.md)):**
- Sequential stream queries are slow
- No time-based stream filtering
- Fetches empty/old streams unnecessarily

### S3 Access for ALB Logs

**Bucket:** `s3://benchling-webhook-alb-logs-712023778557`
**Path Pattern:** `alb-access-logs/AWSLogs/{account}/elasticloadbalancing/{region}/{year}/{month}/{day}/{filename}.log.gz`

**Access Method:**
- `s3:ListBucket` - Required to enumerate files
- `s3:GetObject` - Required to download files
- Files are gzip-compressed

**Log Format:** ALB standard format (space-delimited)

**Fields:**
```
type timestamp elb client:port target:port request_processing_time target_processing_time response_processing_time elb_status_code target_status_code received_bytes sent_bytes "request" "user_agent" ssl_cipher ssl_protocol target_group_arn "trace_id" "domain_name" "chosen_cert_arn" matched_rule_priority request_creation_time "actions_executed" "redirect_url" "error_reason" "target:port_list" "target_status_code_list" "classification" "classification_reason"
```

## Recommended Improvements

### 1. Enable API Gateway Execution Logs

**Benefit:** Debug request routing and integration issues

**Implementation:**
```typescript
// In alb-api-gateway.ts
stage.methodLoggingLevel = apigateway.MethodLoggingLevel.INFO;
```

### 2. Enable Structured Logging in Flask

**Benefit:** Easier parsing and filtering

**Implementation:**
```python
# In docker/src/app.py
import structlog
logger = structlog.get_logger()
logger.info("webhook.received", entry_id=entry_id, event_type=event_type)
```

### 3. Add Log Metric Filters

**Benefit:** Automated alerting on errors

**Implementation:**
```typescript
// In benchling-webhook-stack.ts
logGroup.addMetricFilter('ErrorCount', {
  filterPattern: logs.FilterPattern.literal('ERROR'),
  metricName: 'ApplicationErrors',
  metricNamespace: 'BenchlingWebhook',
  metricValue: '1',
});
```

### 4. Implement CloudWatch Insights Queries

**Benefit:** Pre-built dashboards for common queries

**Saved Queries:**
- Error rate over time
- Request latency percentiles
- Top error messages
- Health check failure rate

### 5. Optimize Log Stream Lifecycle

**Current Problem:** 325 streams, mostly empty

**Proposed Solution:**
- Use `logStreamNamePrefix` with task revision: `benchling-webhook-v61/`
- Set shorter retention (3 days) to prune old streams faster
- Investigate empty streams (failed task starts?)

## Summary

**Total Loggable Resources:** 8
1. ECS Container Logs (CloudWatch)
2. Container Insights Performance (CloudWatch)
3. API Gateway Access Logs (CloudWatch)
4. API Gateway Execution Logs (NOT ENABLED)
5. ALB Access Logs (S3)
6. ALB Health Check Logs (NOT ENABLED)
7. Lambda Custom Resource Logs (CloudWatch)
8. State Machine Logs (CloudWatch, possibly obsolete)

**Primary Log Source:** `BenchlingWebhookStack` log group
**Active Streams:** 2 (current ECS tasks)
**Total Streams:** 325 (historical + current)
**Total CloudWatch Storage:** ~21.5 MB
**Retention Strategy:** Short-term (1-7 days) for debugging

**Key Findings:**
- Most logging is properly configured and working
- Empty log streams indicate task lifecycle issues
- API Gateway execution logs would improve debugging
- ALB logs in S3 require separate tooling
- Current log fetching algorithm has significant performance issues (see [01-log-status.md](01-log-status.md))
