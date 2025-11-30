# Cloud Map Health Check Investigation

**Date**: 2025-11-29
**Issue**: Health check endpoints returning 500 errors, blocking all API Gateway traffic
**Status**: Root cause identified, workaround needed

---

## Direct Observations

### 1. Test Script Behavior
- **File**: `docker/scripts/test_webhook.py:170`
- **Observation**: Test was printing `✅` for ANY HTTP status code, including 500 errors
- **Evidence**:
  ```python
  # Original (incorrect):
  print(f"✅ {endpoint}: {response.status_code} - {response.json()}")
  results.append((endpoint, True))  # Always True!
  ```
- **Fix Applied**: Now validates status codes properly (200 for health/live, 200|503 for ready)
- **Commit**: `498a38d` - "fix(health): resolve health check validation..."

### 2. API Gateway Returns 500 Errors
- **Endpoint**: `https://6u4pe3jxgb.execute-api.us-east-1.amazonaws.com/health`
- **Response**: `{"message":"Internal Server Error"}`
- **HTTP Status**: 500
- **Observation**: Consistent across all health endpoints (/health, /health/ready, /health/live)

### 3. ECS Containers Are Healthy
- **Log Group**: `BenchlingWebhookStack`
- **Evidence**: Continuous stream of successful health checks:
  ```
  2025-11-30T02:12:24 INFO: 127.0.0.1:52786 - "GET /health HTTP/1.1" 200 OK
  2025-11-30T02:12:27 INFO: 127.0.0.1:52786 - "GET /health HTTP/1.1" 200 OK
  ```
- **Container Health Check Config** (`lib/fargate-service.ts:335-341`):
  ```typescript
  healthCheck: {
      command: ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"],
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(10),
      retries: 3,
      startPeriod: cdk.Duration.seconds(60),
  }
  ```
- **ECS Task Health Status**: `aws ecs describe-tasks` shows `"healthStatus": "HEALTHY"`

### 4. Cloud Map Instances Are UNHEALTHY
- **Service ID**: `srv-pahhrxvl3zpkts5f` (original), `srv-72bjzeki4vj7zw6s` (after recreation)
- **Instance Health Status**:
  ```json
  {
    "Id": "6b434297ac8c4522bb52d1496c5545f8",
    "Attributes": {
      "AWS_INIT_HEALTH_STATUS": "UNHEALTHY",
      "AWS_INSTANCE_IPV4": "10.0.32.109",
      "ECS_CLUSTER_NAME": "benchling-webhook-cluster",
      "ECS_SERVICE_NAME": "benchling-webhook-service"
    }
  }
  ```
- **Observation**: ALL Cloud Map instances remain UNHEALTHY despite healthy ECS tasks

### 5. Cloud Map Service Configuration
- **Type**: `DNS_HTTP`
- **Health Check Config**:
  ```json
  {
    "HealthCheckCustomConfig": {
      "FailureThreshold": 1
    }
  }
  ```
- **Observation**: CDK automatically adds `HealthCheckCustomConfig` even when not specified in code
- **Evidence**: Tested with and without explicit `failureThreshold` setting - always present

### 6. API Gateway VPC Link Integration
- **Integration Type**: `HTTP_PROXY`
- **Connection Type**: `VPC_LINK`
- **Integration URI**: `arn:aws:servicediscovery:us-east-1:712023778557:service/srv-pahhrxvl3zpkts5f`
- **Observation**: VPC Link queries Cloud Map for healthy instances
- **Behavior**: Returns 500 when NO healthy instances are available

### 7. Attempted Fixes and Results

#### Attempt 1: Add `failureThreshold: 1`
- **Commit**: `498a38d`
- **Result**: FAILED - Cloud Map still showed UNHEALTHY
- **Evidence**: Service still had `HealthCheckCustomConfig` with no behavior change

#### Attempt 2: Remove `failureThreshold`
- **Commit**: `f96a56d`
- **Result**: FAILED - CDK still adds `HealthCheckCustomConfig` automatically
- **Evidence**: `aws servicediscovery get-service` shows config still present

#### Attempt 3: Recreate Cloud Map Service (name change)
- **Action**: Changed service name from "benchling-webhook" to "benchling-webhook-v2"
- **Result**: FAILED - New service also has `HealthCheckCustomConfig`, instances still UNHEALTHY
- **Evidence**: New service `srv-72bjzeki4vj7zw6s` shows same behavior

#### Attempt 4: Force ECS Service Redeployment
- **Action**: `aws ecs update-service --force-new-deployment`
- **Result**: FAILED - New tasks register with Cloud Map but still show UNHEALTHY

### 8. Traffic Flow Breakdown

```
Request
  ↓
API Gateway HTTP API v2 (6u4pe3jxgb.execute-api.us-east-1.amazonaws.com)
  ↓
VPC Link (vnu1xd) - Queries Cloud Map for healthy instances
  ↓
Cloud Map Service (srv-pahhrxvl3zpkts5f) - Returns: 0 healthy instances
  ↓
API Gateway - No targets available
  ↓
500 Internal Server Error ❌
```

**Actual State**:
```
ECS Tasks (2x): HEALTHY ✅
  ↓ (registered with)
Cloud Map Instances (2x): UNHEALTHY ❌
  ↓ (queried by)
VPC Link: 0 healthy targets
  ↓
API Gateway: 500 error
```

---

## Assumptions & Analysis

### Assumption 1: Cloud Map Custom Health Checks Require Manual Updates
- **Basis**: AWS documentation and observed behavior
- **Supporting Evidence**:
  - ECS does NOT automatically call `UpdateInstanceCustomHealthStatus` API
  - `HealthCheckCustomConfig` expects application or external process to update health
  - ECS only manages registration/deregistration, not health status updates
- **Implication**: Using `HealthCheckCustomConfig` with ECS requires additional application code

### Assumption 2: CDK Always Adds Custom Health Checks for ECS Service Discovery
- **Basis**: Tested multiple configurations, always see `HealthCheckCustomConfig`
- **Supporting Evidence**:
  - Removed `failureThreshold` from code → still present in deployed service
  - Created new service → still has `HealthCheckCustomConfig`
  - Appears to be CDK L2 construct default behavior
- **Implication**: Cannot avoid custom health checks when using CDK's `cloudMapOptions`

### Assumption 3: API Gateway VPC Link Integration Respects Cloud Map Health
- **Basis**: Observed behavior and AWS service integration patterns
- **Supporting Evidence**:
  - Healthy ECS tasks + UNHEALTHY Cloud Map = 500 errors
  - No way to configure VPC Link to ignore health status
  - `HttpServiceDiscoveryIntegration` tightly coupled to Cloud Map
- **Implication**: Must solve Cloud Map health issue to fix API Gateway routing

### Assumption 4: Health Status Stuck at Initial Value
- **Basis**: All instances show `AWS_INIT_HEALTH_STATUS: "UNHEALTHY"`
- **Supporting Evidence**:
  - Status never changes despite:
    - ECS container health checks passing
    - Tasks running for hours
    - Force redeployment
    - Service recreation
- **Implication**: Initial health status is never updated by ECS

---

## Architecture Incompatibility

The v0.9.0 architecture has a fundamental incompatibility:

### Component Requirements
1. **API Gateway HTTP API v2** → Requires healthy targets from VPC Link
2. **VPC Link** → Queries Cloud Map for healthy instances
3. **Cloud Map (DNS_HTTP + HealthCheckCustomConfig)** → Requires manual `UpdateInstanceCustomHealthStatus` API calls
4. **ECS Service** → Only manages instance registration, NOT health status updates
5. **CDK** → Automatically adds `HealthCheckCustomConfig` that can't be disabled

### The Deadlock
```
API Gateway needs: Healthy Cloud Map instances
Cloud Map health requires: Manual API calls to UpdateInstanceCustomHealthStatus
ECS provides: Only instance registration, no health updates
CDK enforces: HealthCheckCustomConfig that requires manual updates
Result: Permanent UNHEALTHY status → 500 errors
```

---

## Previous Working Architecture (v0.8.x)

**From commit history** (`610efee` - "refactor(security)!: move HMAC verification to FastAPI..."):

```
Benchling
  ↓
REST API Gateway
  ↓
VPC Link
  ↓
Network Load Balancer (NLB) ← Key difference!
  ↓
Target Group (with health checks)
  ↓
ECS Tasks (Fargate)
```

**Why this worked**:
- NLB has native target health checks (TCP/HTTP)
- NLB health checks integrate directly with ECS task health
- No Cloud Map health status dependency
- Proven reliable, but costs $16/month

**Why it was removed** (speculation based on commits):
- Cost optimization attempt
- Cloud Map seemed simpler (no NLB resource)
- HTTP API v2 has native Cloud Map integration
- Didn't anticipate health check incompatibility

---

## Solution Options

### Option 1: Restore Network Load Balancer (RECOMMENDED)
**Architecture**:
```
API Gateway HTTP API v2
  ↓
VPC Link
  ↓
Network Load Balancer ← Add this back
  ↓
Target Group (HTTP:8080 health checks)
  ↓
ECS Fargate Tasks
```

**Pros**:
- Proven working in v0.8.x
- NLB health checks natively integrate with ECS
- No Cloud Map health status issues
- Reliable and well-documented pattern

**Cons**:
- $16.20/month cost (LCU charges minimal for low traffic)
- Additional infrastructure component

**Implementation**: See `spec/2025-11-26-architecture/03-arch-26.md` (NLB architecture)

### Option 2: Implement Custom Health Status Updates in FastAPI
**Changes Required**:
1. Add AWS SDK (boto3) to FastAPI application
2. On container startup, call `UpdateInstanceCustomHealthStatus(Healthy)`
3. Periodically update health status (every 30s)
4. On shutdown, call `UpdateInstanceCustomHealthStatus(Unhealthy)`

**Pros**:
- No additional AWS resources
- Lower cost

**Cons**:
- Application now responsible for infrastructure concerns
- Adds complexity and potential failure points
- Must handle AWS API failures gracefully
- Requires Cloud Map service ID/instance ID discovery

**Code Changes**:
```python
# docker/src/cloud_map_health.py
import boto3
import os

def update_health_status(status: str):
    """Update Cloud Map instance health status."""
    client = boto3.client('servicediscovery')
    service_id = os.getenv('CLOUD_MAP_SERVICE_ID')
    instance_id = os.getenv('CLOUD_MAP_INSTANCE_ID')  # How to get this?

    client.update_instance_custom_health_status(
        ServiceId=service_id,
        InstanceId=instance_id,
        Status=status  # 'HEALTHY' or 'UNHEALTHY'
    )
```

### Option 3: Switch to Private Application Load Balancer (ALB)
**Similar to Option 1 but with ALB**:
- HTTP-native (better for HTTP workloads)
- More expensive (~$22/month)
- More features (path-based routing, host-based routing)
- Overkill for this use case

---

## Recommendation

**Restore Network Load Balancer** (Option 1)

**Rationale**:
1. **Proven**: Worked in v0.8.x with no issues
2. **Reliable**: Well-documented AWS pattern
3. **Simple**: No application code changes needed
4. **Cost-effective**: $16/month is minimal compared to debugging time
5. **Separation of Concerns**: Infrastructure handles routing, app handles business logic

**Cost Analysis**:
- NLB fixed cost: ~$16.20/month
- LCU charges: Negligible for webhook workload (few requests/sec)
- Total: ~$17/month
- **Value**: Eliminates health check incompatibility permanently

**Implementation Path**:
1. Reference `spec/2025-11-26-architecture/03-arch-26.md` for NLB design
2. Add NLB + Target Group to CDK stack
3. Update VPC Link to point to NLB (not Cloud Map)
4. Remove Cloud Map service discovery
5. Keep ECS container health checks (NLB will use them)
6. Test and verify

---

## Open Questions

1. **Can CDK's `cloudMapOptions` be configured to NOT add `HealthCheckCustomConfig`?**
   - Research needed: Check CDK source code or escape hatches
   - Tried: Setting/unsetting `failureThreshold` - no effect

2. **Does HTTP API v2 VPC Link have a setting to ignore Cloud Map health?**
   - Research needed: AWS API Gateway documentation
   - Assumption: No, based on integration behavior

3. **Why did v0.8.x → v0.9.0 remove NLB?**
   - Check: Git commit messages and architecture decision records
   - Likely: Cost optimization or architectural simplification

4. **Alternative: Can we use Cloud Map without health checks entirely?**
   - Research: Create Cloud Map service with Type=DNS only (no HTTP)
   - Risk: May not integrate with VPC Link properly

5. **✅ ANSWERED: Does HTTP API v2 support resource policies for IP filtering?**
   - **NO** - HTTP API v2 does NOT support resource policies
   - Evidence: `aws apigatewayv2 update-api --generate-cli-skeleton` shows no `Policy` parameter
   - Current API has no `Policy` field: `aws apigatewayv2 get-api` confirms
   - HTTP API v2 access control options:
     - JWT authorizers
     - Lambda authorizers
     - CORS configuration
     - **WAF** (what we're currently using)
   - **Conclusion**: WAF is the ONLY way to do IP filtering on HTTP API v2
   - Alternative: Switch to REST API (v1) which supports resource policies, but loses HTTP/2 benefits

---

## Conclusion

The v0.9.0 architecture (API Gateway → VPC Link → Cloud Map → ECS) has a fundamental incompatibility in health check management. Cloud Map's custom health checks require manual API calls that ECS doesn't provide, causing all instances to remain UNHEALTHY and blocking API Gateway traffic.

**The test script fix is complete and working correctly** - it now properly validates HTTP status codes.

**The infrastructure issue requires architectural changes**. Based on time invested and complexity discovered, **restoring the Network Load Balancer from v0.8.x is the recommended solution**.
