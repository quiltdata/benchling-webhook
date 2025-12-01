# FastAPI Flexible Routes for NLB Integration

**Date**: 2025-11-30
**Status**: Proposed
**Context**: REST API v1 + NLB HTTP_PROXY forwards full path including stage prefix

## Problem

With REST API v1 + NLB + HTTP_PROXY integration, the API Gateway forwards the complete request path including the stage prefix to the backend:

- Request: `GET /prod/health`
- Forwarded to FastAPI: `GET /prod/health` (not `GET /health`)

Current FastAPI routes only handle:
- `/health`
- `/health/ready`
- `/health/live`
- `/event`
- `/lifecycle`
- `/canvas`

This causes all API Gateway requests to return 404 because FastAPI doesn't recognize paths with stage prefixes.

## Root Cause

HTTP_PROXY integration type always forwards the entire path. Unlike HTTP API v2 or ALB integrations, REST API v1 with NLB cannot strip the stage prefix at the infrastructure level.

## Solution: Flexible Route Matching

Update FastAPI to accept paths **with or without** stage prefixes. This maintains compatibility with:
1. Direct health checks from NLB (no prefix)
2. API Gateway requests (with stage prefix)
3. Future ALB migration (configurable)

### Implementation Strategy

#### Option A: Duplicate Route Definitions (Recommended)

```python
from fastapi import FastAPI, Request

app = FastAPI()

# Direct routes (for NLB health checks)
@app.get("/health")
async def health():
    return {"status": "healthy"}

@app.get("/health/ready")
async def health_ready():
    return {"status": "ready"}

@app.get("/health/live")
async def health_live():
    return {"status": "live"}

@app.post("/event")
async def handle_event(request: Request):
    # existing implementation
    pass

# Stage-prefixed routes (for API Gateway)
# Matches: /prod/health, /dev/health, /staging/health, etc.
@app.get("/{stage}/health")
async def health_with_stage(stage: str):
    return {"status": "healthy"}

@app.get("/{stage}/health/ready")
async def health_ready_with_stage(stage: str):
    return {"status": "ready"}

@app.get("/{stage}/health/live")
async def health_live_with_stage(stage: str):
    return {"status": "live"}

@app.post("/{stage}/event")
async def handle_event_with_stage(stage: str, request: Request):
    # existing implementation (same as above)
    pass

@app.post("/{stage}/lifecycle")
async def handle_lifecycle_with_stage(stage: str, request: Request):
    # existing implementation
    pass

@app.post("/{stage}/canvas")
async def handle_canvas_with_stage(stage: str, request: Request):
    # existing implementation
    pass
```

**Pros**:
- Simple and explicit
- No middleware complexity
- FastAPI route matching handles everything
- Easy to understand and debug

**Cons**:
- Code duplication (but can be minimized with shared handler functions)

#### Option B: Middleware Path Rewriting

```python
from fastapi import FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware
import re

class StageStripMiddleware(BaseHTTPMiddleware):
    """Strip API Gateway stage prefix from request paths."""

    STAGE_PATTERN = re.compile(r'^/(prod|dev|staging|test)(/.*)$')

    async def dispatch(self, request: Request, call_next):
        # Check if path starts with a known stage
        match = self.STAGE_PATTERN.match(request.url.path)
        if match:
            stage, path = match.groups()
            # Rewrite the path by removing stage prefix
            scope = request.scope.copy()
            scope["path"] = path
            request = Request(scope, request.receive)

        response = await call_next(request)
        return response

app = FastAPI()
app.add_middleware(StageStripMiddleware)

# Keep existing routes unchanged
@app.get("/health")
async def health():
    return {"status": "healthy"}
```

**Pros**:
- No route duplication
- Centralized path handling
- Existing routes unchanged

**Cons**:
- More complex (middleware + regex)
- Harder to debug path matching issues
- Must maintain list of valid stages

#### Option C: FastAPI root_path Configuration

```python
from fastapi import FastAPI
import os

# Configure FastAPI to expect a root path prefix
stage = os.environ.get("API_GATEWAY_STAGE", "")
app = FastAPI(root_path=f"/{stage}" if stage else "")

# Existing routes work automatically
@app.get("/health")
async def health():
    return {"status": "healthy"}
```

**Pros**:
- Clean FastAPI-native solution
- No code duplication
- Works with OpenAPI docs

**Cons**:
- Requires passing stage as environment variable
- Fixed at deployment time (can't handle multiple stages)
- Doesn't work for direct NLB health checks (no prefix)

## Recommendation: Option A (Duplicate Routes)

**Rationale**:
1. **Simplest to implement and maintain** - No middleware complexity
2. **Most explicit** - Easy to see what paths are supported
3. **Best debugging** - Clear route matching in logs
4. **Flexible** - Works with any stage name without configuration
5. **Cost-effective** - Keeps NLB ($16/month vs $23/month for ALB)

Code duplication can be minimized by extracting shared handler logic:

```python
async def _handle_event_impl(request: Request):
    """Shared event handling logic."""
    # Implementation here
    pass

@app.post("/event")
async def handle_event(request: Request):
    return await _handle_event_impl(request)

@app.post("/{stage}/event")
async def handle_event_with_stage(stage: str, request: Request):
    return await _handle_event_impl(request)
```

## Implementation Plan

1. ✅ Update REST API Gateway to use `{proxy+}` greedy path variable
2. ⏭️ Add stage-prefixed routes to FastAPI (docker/app/main.py)
3. ⏭️ Extract shared handler logic to avoid duplication
4. ⏭️ Update tests to verify both path styles work
5. ⏭️ Deploy and verify health checks work
6. ⏭️ Document the dual-path approach in CLAUDE.md

## Testing Strategy

### Unit Tests
```python
from fastapi.testclient import TestClient

client = TestClient(app)

def test_health_direct():
    """Test direct path (NLB health checks)."""
    response = client.get("/health")
    assert response.status_code == 200

def test_health_with_stage():
    """Test stage-prefixed path (API Gateway)."""
    response = client.get("/prod/health")
    assert response.status_code == 200

def test_health_any_stage():
    """Test arbitrary stage names."""
    for stage in ["prod", "dev", "staging", "test"]:
        response = client.get(f"/{stage}/health")
        assert response.status_code == 200
```

### Integration Tests
```bash
# Direct NLB health check
curl http://nlb-dns/health

# API Gateway with stage
curl https://api-gateway-url/prod/health

# Both should return 200 OK
```

## Future Considerations

### Migration to ALB

If we later decide to migrate to ALB for better path handling:

1. ALB can be configured to strip the stage prefix at the load balancer level
2. Remove stage-prefixed routes from FastAPI
3. Keep only direct routes (`/health`, `/event`, etc.)
4. No changes needed to API Gateway configuration

### Multi-Stage Support

Current approach supports any stage name dynamically:
- `/prod/health` ✅
- `/dev/health` ✅
- `/staging/health` ✅
- `/v2/health` ✅

No configuration changes needed when adding new stages.

## Cost Impact

**No additional cost** - This is a code-only change.

Maintains current NLB setup:
- NLB: $16.20/month
- No ALB needed: Save $7/month
- Total: $16.20/month (lowest cost option)

## Security Considerations

- HMAC verification still applies to all webhook endpoints
- Health endpoints remain unauthenticated (required for load balancer health checks)
- Resource policy IP filtering (when configured) still applies at API Gateway

## Documentation Updates

Update [CLAUDE.md](../../CLAUDE.md) Architecture section:

```markdown
### Request Flow

Internet → API Gateway (stage: /prod) → VPC Link → NLB → ECS Fargate

**Path Handling:**
- API Gateway receives: `GET /prod/health`
- Forwards to NLB: `GET /prod/health` (HTTP_PROXY includes stage)
- FastAPI accepts both:
  - `/health` (direct, for NLB health checks)
  - `/{stage}/health` (from API Gateway)

This dual-path approach maintains cost-efficiency (NLB) while supporting
both direct health checks and API Gateway stage-prefixed requests.
```

## References

- [AWS REST API HTTP Proxy Integration](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-set-up-simple-proxy.html)
- [FastAPI Path Parameters](https://fastapi.tiangolo.com/tutorial/path-params/)
- [FastAPI Middleware](https://fastapi.tiangolo.com/tutorial/middleware/)
- [AWS VPC Link Documentation](https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-private-integration.html)
