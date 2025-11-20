# Issue #170: Remove Public ALB - Implementation Specification

**Status:** Draft
**Created:** 2025-11-19
**Goal:** Remove public ALB, use API Gateway + VPC Link + private NLB for HTTPS without custom domain

---

## Architecture

### Current State

```
Benchling → API Gateway (HTTPS, public) → ALB (HTTP, public) → Fargate (private)
```

**Issues:**

- Redundant public infrastructure (both API Gateway and ALB are public)
- ALB adds unnecessary cost and complexity
- Cannot share ALB across services

### Target State

```
Benchling → API Gateway (HTTPS, IP filtered) → VPC Link → NLB (private) → Fargate (private)
```

**Benefits:**

- ✅ HTTPS without custom domain (API Gateway AWS-managed domain)
- ✅ Backend fully private (NLB not internet-facing)
- ✅ IP filtering at API Gateway (Resource Policy)
- ✅ NLB can be shared across services
- ✅ Simpler public attack surface

### Component Responsibilities

| Component | Responsibility | Public/Private |
|-----------|---------------|----------------|
| API Gateway | HTTPS termination, IP filtering, routing | Public |
| VPC Link | Connect API Gateway to private NLB | AWS Managed |
| NLB | Load balancing, health checks, backup filtering | Private |
| Fargate | Application logic | Private |

---

## Implementation Checklist

### 1. Infrastructure Changes

#### Create Private NLB

- [ ] Create NLB construct in `lib/` (or update existing)
- [ ] Configure as `internal` (not internet-facing)
- [ ] Add target group for Fargate service
- [ ] Configure health check endpoint (`/health`)
- [ ] Add CloudWatch logging
- [ ] Support optional props for sharing NLB across stacks

#### Create VPC Link

- [ ] Create VPC Link pointing to private NLB
- [ ] Configure VPC Link name and description
- [ ] Add CloudWatch logging
- [ ] Handle VPC Link creation timing (can take 10+ minutes)

#### Update API Gateway Integration

- [ ] Replace HTTP integration with VPC Link integration
- [ ] Update integration type to `VPC_LINK`
- [ ] Configure request/response transformations if needed
- [ ] Update stage configuration

#### Add IP Filtering

- [ ] Implement API Gateway Resource Policy with IP allowlist
- [ ] Use `IpAddress` condition with `aws:SourceIp`
- [ ] Configure DENY for all non-allowlisted IPs [WHEN Allowlist is non-empty]
- [ ] Make IP list configurable (from profile config)
- [ ] Add NLB Security Group with same IP allowlist (defense in depth)

#### Remove Public ALB

- [ ] Delete `lib/alb-api-gateway.ts` construct
- [ ] Remove ALB references from `lib/benchling-webhook-stack.ts`
- [ ] Remove ALB-specific configuration from stack
- [ ] Clean up unused imports and types

#### Update Stack Outputs

- [ ] Keep API Gateway endpoint URL output
- [ ] Add VPC Link ID output
- [ ] Add NLB DNS name output (for debugging)
- [ ] Remove ALB-specific outputs

### 2. Configuration Schema

#### Add New Fields

- [ ] `security.benchlingIpAllowList` - Array of CIDR blocks for API Gateway Resource Policy
- [ ] `deployment.vpcLinkName` - Optional VPC Link name (for sharing)
- [ ] `deployment.nlbArn` - Optional existing NLB ARN (for sharing)

#### Deprecate Old Fields

- [ ] Mark `security.webhookAllowList` as deprecated (if different format)
- [ ] Add migration helper in setup wizard

### 3. Testing

#### Unit Tests

- [ ] Test NLB construct creation
- [ ] Test VPC Link creation
- [ ] Test API Gateway Resource Policy generation
- [ ] Test Security Group ingress rule generation
- [ ] Test CIDR validation

#### Integration Tests

- [ ] Deploy to dev environment
- [ ] Verify HTTPS endpoint works
- [ ] Verify IP filtering (test from allowed IP)
- [ ] Verify IP blocking (test from non-allowed IP)
- [ ] Verify health checks pass
- [ ] Verify webhook delivery end-to-end

#### Security Validation

- [ ] Confirm NLB is not internet-facing
- [ ] Confirm Fargate tasks are in private subnets
- [ ] Confirm API Gateway Resource Policy blocks unknown IPs
- [ ] Confirm Security Groups have minimal ingress rules

### 4. Configuration Updates

#### Setup Wizard

- [ ] Add prompt for Benchling IP addresses
- [ ] Validate CIDR format
- [ ] Support multiple IP ranges
- [ ] Update `scripts/install-wizard.ts`

#### Profile Config

- [ ] Update `ProfileConfig` type in `lib/types/config.ts`
- [ ] Add validation for new fields
- [ ] Support profile inheritance for IP allowlist

#### Migration

- [ ] Create migration script for existing deployments
- [ ] Document breaking changes
- [ ] Provide rollback procedure

### 5. Documentation

#### Code Documentation

- [ ] Add JSDoc comments to new constructs
- [ ] Document VPC Link creation timing
- [ ] Document NLB sharing pattern

#### User Documentation

- [ ] Update [CLAUDE.md](CLAUDE.md) with new architecture
- [ ] Update README.md architecture diagram
- [ ] Create migration guide for existing users
- [ ] Document Benchling IP address requirements

#### Spec Documents

- [ ] Update [spec/a02-prod-docker.md](spec/a02-prod-docker.md) if affected
- [ ] Create troubleshooting guide for VPC Link issues
- [ ] Document cost comparison (old vs new)

---

## Configuration Example

```json
{
  "security": {
    "benchlingIpAllowList": [
      "52.203.123.45/32",
      "54.210.98.76/32"
    ]
  },
  "deployment": {
    "region": "us-east-1",
    "vpcLinkName": "benchling-webhook-vpc-link"
  }
}
```

---

## Cost Analysis

| Component | Old Architecture | New Architecture | Change |
|-----------|------------------|------------------|--------|
| API Gateway | $65-70/month | $65-70/month | Same |
| ALB | ~$16/month | **Removed** | -$16 |
| NLB | N/A | ~$16/month | +$16 |
| VPC Link | N/A | ~$7/month | +$7 |
| **Total** | ~$81-86/month | ~$88-93/month | +$7/month |

**Net change:** +$7/month for improved security (private backend)

---

## Security Considerations

### IP Filtering Strategy

1. **Primary:** API Gateway Resource Policy (blocks at edge)
2. **Secondary:** NLB Security Group (defense in depth)

### Attack Surface Reduction

- Old: API Gateway (public) + ALB (public)
- New: API Gateway (public) only
- Backend (NLB + Fargate) fully private

### Benchling IP Addresses

- Obtain from Benchling support
- Format as CIDR blocks (e.g., `52.203.123.45/32`)
- Update via configuration, no code changes needed

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| VPC Link creation fails | Deployment blocked | Add retry logic, clear error messages |
| VPC Link takes >10 min | Slow deployments | Document timing, consider pre-creating |
| IP allowlist incorrect | Webhooks blocked | Validation in setup wizard, test endpoint |
| NLB health check fails | No traffic routing | Clear health check logs, `/health` endpoint |
| Cost increase | Budget overrun | Document cost increase, get approval |

---

## Success Criteria

- [ ] Dev deployment succeeds with new architecture
- [ ] HTTPS endpoint accessible from allowed IPs
- [ ] HTTPS endpoint blocks non-allowed IPs
- [ ] Webhooks deliver successfully end-to-end
- [ ] Health checks pass consistently
- [ ] All tests pass
- [ ] Documentation updated
- [ ] Migration guide available
- [ ] Cost increase approved

---

## Timeline Estimate

- Infrastructure changes: 2-3 days
- Testing and validation: 1-2 days
- Documentation: 1 day
- **Total:** 4-6 days

---

## Related Files

- [lib/benchling-webhook-stack.ts](lib/benchling-webhook-stack.ts) - Main stack orchestration
- [lib/alb-api-gateway.ts](lib/alb-api-gateway.ts) - **TO BE DELETED**
- [lib/fargate-service.ts](lib/fargate-service.ts) - Fargate service (update NLB integration)
- [lib/types/config.ts](lib/types/config.ts) - Configuration schema
- [scripts/install-wizard.ts](scripts/install-wizard.ts) - Setup wizard
- [CLAUDE.md](CLAUDE.md) - Developer guide

---

## References

- [AWS Blog: Access Private Applications on AWS Fargate using Amazon API Gateway PrivateLink](https://aws.amazon.com/blogs/compute/access-private-applications-on-aws-fargate-using-amazon-api-gateway-privatelink/)
- [API Gateway Resource Policies](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-resource-policies.html)
- [VPC Links for API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vpc-links.html)
- GitHub Issue: #170
