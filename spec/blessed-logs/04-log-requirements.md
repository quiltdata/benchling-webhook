# Log Display Requirements - Standalone vs Integrated

## Priority Matrix

### Standalone Deployment (BenchlingWebhookStack)

| Priority | Log Source | Log Group/Location | Stream Prefix | Status | Action Required |
|----------|------------|-------------------|---------------|--------|-----------------|
| **P0** | ECS Flask Container | `BenchlingWebhookStack` | `benchling-webhook/BenchlingWebhookContainer/` | ✅ Enabled | None |
| **P1** | API Gateway Access | `/aws/apigateway/benchling-webhook` | N/A | ✅ Enabled | None |
| **P2** | ALB Access Logs | S3: `benchling-webhook-alb-logs-{account}` | `alb-access-logs/` | ✅ Enabled | Parse gzipped S3 files |
| **P3** | Container Insights | `/aws/ecs/containerinsights/benchling-webhook-cluster/performance` | N/A | ✅ Enabled | Query with CW Insights |
| ~~P4~~ | ~~API Gateway Execution~~ | ~~`API-Gateway-Execution-Logs_*/prod`~~ | ~~N/A~~ | ❌ Disabled | ~~Enable in stage settings~~ |
| ~~P5~~ | ~~ALB Health Checks~~ | ~~S3~~ | ~~N/A~~ | ❌ Disabled | ~~Not worth enabling~~ |

### Integrated Deployment (Quilt Stack)

| Priority | Log Source | Log Group/Location | Stream Prefix | Status | Action Required |
|----------|------------|-------------------|---------------|--------|-----------------|
| **P0** | ECS Flask Container | `{stackName}` (shared) | `benchling/benchling/` | ✅ Enabled | Filter shared log group |
| **P0** | ECS Nginx Proxy | `{stackName}` (shared) | `benchling-nginx/nginx/` | ✅ Enabled | Filter shared log group |
| **P2** | HTTP API Gateway Access | `/aws/apigateway/{stackName}-benchling` | N/A | ❌ **NOT CONFIGURED** | **Enable in template** |
| ~~P3~~ | ~~VPC Link~~ | ~~N/A~~ | ~~N/A~~ | ❌ Not available | N/A (no direct logs) |
| ~~P4~~ | ~~HTTP API Execution~~ | ~~N/A~~ | ~~N/A~~ | ❌ Not available | N/A (HTTP API limitation) |
| ~~P5~~ | ~~ALB Logs~~ | ~~N/A~~ | ~~N/A~~ | N/A | N/A (no ALB in integrated) |

---

## Implementation Requirements

### Standalone: What to Show

**Default View (No flags):**
```
1. ECS Flask Container logs (filter out health checks)
   - Show: Application logs, errors, webhook processing
   - Hide: /health and /health/ready requests (summarize count)
```

**Extended View (`--all-containers` or `--type=all`):**
```
1. ECS Flask Container logs
2. API Gateway Access logs (if available)
3. Health check summary
```

**Debug View (`--verbose` or `--debug`):**
```
1. ECS Flask Container logs (including health checks)
2. API Gateway Access logs
3. ALB Access logs (from S3)
4. Container Insights metrics
```

### Integrated: What to Show

**Default View (No flags):**
```
1. ECS Flask Container logs (benchling/benchling/*)
2. ECS Nginx Proxy logs (benchling-nginx/nginx/*)
   - Show: Non-health application traffic
   - Hide: Health checks (summarize count)
```

**Extended View (`--all-containers` or `--type=all`):**
```
1. ECS Flask Container logs
2. ECS Nginx Proxy logs
3. HTTP API Gateway Access logs (if available)
4. Health check summary
```

**Debug View (`--verbose` or `--debug`):**
```
1. ECS Flask Container logs (including health checks)
2. ECS Nginx Proxy logs (including health checks)
3. HTTP API Gateway Access logs
4. Other Quilt service logs (registry, s3-proxy, etc.) - for context
```

---

## Critical Gaps to Address

### Standalone
- ✅ **No critical gaps** - All essential logs available

### Integrated
- ⚠️ **Missing HTTP API Gateway Access Logs** - Must enable in CloudFormation template
- ⚠️ **Shared log group noise** - Must filter effectively to show only Benchling streams

---

## Configuration Actions Required

### For Standalone (No changes needed)
```
✅ All logs already enabled and accessible
```

### For Integrated (Template changes needed)

**Add to `benchling.py`:**
```python
# 1. Create API Gateway log group
api_log_group = logs.LogGroup(
    "BenchlingApiLogGroup",
    template=cft,
    Condition="BenchlingEnabled",
    LogGroupName=Sub("/aws/apigateway/${AWS::StackName}-benchling"),
    RetentionInDays=7,
)

# 2. Configure stage with access logging
stage = apigatewayv2.Stage(
    "BenchlingStage",
    template=cft,
    Condition="BenchlingEnabled",
    ApiId=Ref(api),
    StageName="$default",
    AutoDeploy=True,
    AccessLogSettings=apigatewayv2.AccessLogSettings(
        DestinationArn=api_log_group.get_att("Arn"),
        Format='$context.requestId $context.routeKey $context.status $context.error.message',
    ),
)
```

---

## Log Discovery Algorithm

### Standalone Detection
```python
def get_standalone_logs(profile: str, region: str) -> List[LogSource]:
    return [
        LogSource(
            type="ecs",
            log_group="BenchlingWebhookStack",
            stream_prefix="benchling-webhook/",
            priority=0,
        ),
        LogSource(
            type="api-gateway",
            log_group="/aws/apigateway/benchling-webhook",
            stream_prefix=None,
            priority=1,
        ),
    ]
```

### Integrated Detection
```python
def get_integrated_logs(stack_name: str, region: str) -> List[LogSource]:
    # Check if Benchling enabled
    if not is_benchling_enabled(stack_name, region):
        return []

    sources = [
        LogSource(
            type="ecs-flask",
            log_group=stack_name,
            stream_prefix="benchling/benchling/",
            priority=0,
        ),
        LogSource(
            type="ecs-nginx",
            log_group=stack_name,
            stream_prefix="benchling-nginx/nginx/",
            priority=0,
        ),
    ]

    # Check if API Gateway access logs exist
    api_log_group = f"/aws/apigateway/{stack_name}-benchling"
    if log_group_exists(api_log_group, region):
        sources.append(
            LogSource(
                type="api-gateway",
                log_group=api_log_group,
                stream_prefix=None,
                priority=2,
            )
        )

    return sources
```

---

## Health Check Handling

### Both Deployments

**Health Check Patterns:**
```python
HEALTH_CHECK_PATTERNS = [
    "/health",
    "/health/ready",
    "ELB-HealthChecker",
    "GET /health HTTP",
]
```

**Display Strategy:**
```
1. Filter out health checks from main log view
2. Show summary at top:
   "✓ /health: HEALTHY @ 2s ago ×1,234 checks"
   "✓ /health/ready: HEALTHY @ 1s ago ×5,678 checks"
3. Include in --verbose mode
```

---

## Summary

### Standalone
- **P0:** ECS Flask logs (already enabled)
- **P1:** API Gateway access logs (already enabled)
- **Action:** None required

### Integrated
- **P0:** ECS Flask + Nginx logs (already enabled)
- **P2:** HTTP API Gateway logs (**must enable in template**)
- **Action:** Modify `benchling.py` to add access logging

### Key Difference
- Standalone: 1 container, dedicated log group
- Integrated: 2 containers, shared log group (requires filtering)
