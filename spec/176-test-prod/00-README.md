# Issue #176: Test Production Deployments - Specification

**Status**: In Progress - Specification Complete
**Created**: 2025-11-04
**Last Updated**: 2025-11-04

---

## Overview

This directory contains the complete specification and implementation plan for adding proper multi-environment support to the Benchling Webhook system.

**Problem**: Current system has confusing dev/prod distinction that exists only in deployment tracking, not in actual AWS infrastructure.

**Solution**: Use API Gateway stages + XDG profiles to create true dev/prod environments in a single stack.

---

## Document Index

### Requirements & Analysis

1. **[01-requirements.md](01-requirements.md)**
   - Original requirements for production deployment testing
   - User stories and acceptance criteria

2. **[02-analysis.md](02-analysis.md)**
   - Current system analysis
   - Pain points and gaps

3. **[11-multi-environment-analysis.md](11-multi-environment-analysis.md)**
   - Deep dive into current multi-account model
   - Why separate stacks per environment doesn't work

### Solution Design

4. **[13-multi-environment-architecture-spec.md](13-multi-environment-architecture-spec.md)** ⭐
   - **MAIN SPECIFICATION**
   - Complete architecture design
   - API Gateway stages + profiles
   - Implementation plan with code examples
   - Cost analysis and migration path

### Implementation Plans

5. **[03-specifications.md](03-specifications.md)**
   - Technical specifications
   - API contracts and interfaces

6. **[04-phases.md](04-phases.md)**
   - Implementation phases
   - Rollout strategy

7. **[06-phase1-design.md](06-phase1-design.md)**
   - Phase 1 detailed design
   - Initial deployment testing

8. **[07-phase1-episodes.md](07-phase1-episodes.md)**
   - Episode-by-episode implementation guide

9. **[08-phase1-checklist.md](08-phase1-checklist.md)**
   - Implementation checklist
   - Progress tracking

### Supporting Analysis

10. **[09-script-consolidation.md](09-script-consolidation.md)**
    - Script cleanup and consolidation

11. **[10-test-dev-auto-deploy.md](10-test-dev-auto-deploy.md)**
    - Auto-deployment feature for dev testing

12. **[11-script-analysis.md](11-script-analysis.md)** + **[12-consolidation-proposal.md](12-consolidation-proposal.md)**
    - Comprehensive analysis of script directories
    - Consolidation proposal (3 options, phased migration)

---

## Quick Start

### For Understanding the Problem

Read in this order:
1. [02-analysis.md](02-analysis.md) - What's wrong?
2. [11-multi-environment-analysis.md](11-multi-environment-analysis.md) - Why current approach exists

### For Understanding the Solution

Read:
- **[13-multi-environment-architecture-spec.md](13-multi-environment-architecture-spec.md)** - Complete design

### For Implementation

Follow:
1. [04-phases.md](04-phases.md) - Overall strategy
2. [13-multi-environment-architecture-spec.md](13-multi-environment-architecture-spec.md) - Detailed implementation
3. [08-phase1-checklist.md](08-phase1-checklist.md) - Track progress

---

## Key Decisions

### Decision 1: API Gateway Stages vs Separate Stacks

**Chosen**: API Gateway Stages

**Rationale**:
- ✅ Cost-effective (shared infrastructure)
- ✅ Simple (single stack)
- ✅ No breaking changes
- ✅ Standard AWS pattern

### Decision 2: Profile System for Configuration

**Chosen**: XDG Profiles (`default.json`, `dev.json`)

**Rationale**:
- ✅ Already implemented in codebase
- ✅ Supports different Benchling apps per environment
- ✅ Simple for end users (default profile)
- ✅ Flexible for maintainers (custom profiles)

### Decision 3: Shared vs Separate Infrastructure

**Chosen**: Shared ALB/Cluster, Separate ECS Services

**Rationale**:
- ✅ Cost-effective (single ALB, NAT Gateway)
- ✅ Proper isolation (separate containers)
- ✅ Flexible scaling policies per environment
- ✅ Independent deployments

---

## Current Status

### Completed
- ✅ Requirements gathering
- ✅ Current system analysis
- ✅ Architecture design
- ✅ Implementation specification written
- ✅ Fixed XDG_CONFIG path bug in Makefile
- ✅ Fixed trailing slash in endpoint URLs

### In Progress
- 🔄 Specification review

### Not Started
- ⏳ CDK implementation
- ⏳ Profile system enhancement
- ⏳ Deployment command updates
- ⏳ Testing
- ⏳ Documentation updates

---

## Architecture Summary

### Current (v0.6.3)

```
Single Stack: BenchlingWebhookStack
├── API Gateway → Stage: "prod" (hardcoded)
├── ECS Service → Single service, one image tag
└── deploy.json → Tracks "dev" and "prod" (misleading)
```

**Problem**: Both `deploy:dev` and `deploy:prod` overwrite the same deployment.

### Proposed (v0.7.0)

```
Single Stack: BenchlingWebhookStack
├── API Gateway
│   ├── Stage: dev  → https://.../dev/*  → ECS Service (dev)
│   └── Stage: prod → https://.../prod/* → ECS Service (prod)
│
├── ECS Services
│   ├── benchling-webhook-dev  (image: latest, secret: dev/tenant)
│   └── benchling-webhook-prod (image: v0.6.3, secret: default/tenant)
│
└── Profiles
    ├── default.json (prod config)
    └── dev.json     (dev config, optional)
```

**Benefits**: True environment isolation, cost-effective, no breaking changes.

---

## Cost Impact

| Scenario | Monthly Cost | Change |
|----------|-------------|--------|
| Current (single env) | ~$70-100 | Baseline |
| Proposed (dual env) | ~$85-145 | +15-45% |
| Separate accounts (current for isolation) | ~$140-200 | +100% |

**Conclusion**: Proposed approach provides 80% of multi-account isolation at 20% of the cost.

---

## Migration Path

### Phase 1: Non-Breaking Changes
1. Add multi-stage API Gateway
2. Add profile support to deployment
3. Both stages initially route to same backend

### Phase 2: Service Separation
1. Create separate ECS services
2. Route stages to respective services
3. Update deployment tracking

### Phase 3: Production Rollout
1. Deploy to test environments
2. Update documentation
3. Announce to users
4. Monitor metrics

**Timeline**: 2-3 sprints (assuming 2-week sprints)

---

## Success Metrics

### Technical
- [ ] Both dev and prod stages accessible
- [ ] Separate ECS services running
- [ ] Independent deployments work
- [ ] Tests pass for both environments
- [ ] No increase in deployment time

### User Experience
- [ ] End users unaffected (continue using default profile)
- [ ] Maintainers can run both environments
- [ ] Clear documentation
- [ ] No manual intervention needed

### Cost
- [ ] Infrastructure cost increase < 50%
- [ ] No new AWS service requirements
- [ ] Cost allocation tags working

---

## Next Steps

1. **Review this specification** with team
2. **Get approval** for approach
3. **Begin Phase 1 implementation**
4. **Track progress** in [08-phase1-checklist.md](08-phase1-checklist.md)

---

## Questions?

- See [13-multi-environment-architecture-spec.md](13-multi-environment-architecture-spec.md) for detailed design
- Check [11-multi-environment-analysis.md](11-multi-environment-analysis.md) for rationale
- Review [04-phases.md](04-phases.md) for rollout strategy

---

## References

- **Issue**: #176 - Test Production Deployments
- **Main Spec**: [13-multi-environment-architecture-spec.md](13-multi-environment-architecture-spec.md)
- **Codebase**: `/Users/ernest/GitHub/benchling-webhook`
- **Config**: `~/.config/benchling-webhook/`

---

## Bug Fixes Completed

As part of this work, the following bugs were discovered and fixed:

1. **XDG_CONFIG Path Issue** ([docker/Makefile](../../docker/Makefile))
   - **Problem**: `$(XDG_CONFIG)` variable was used but never defined, causing paths to resolve to `/deploy.json` instead of `~/.config/benchling-webhook/deploy.json`
   - **Fix**: Added `XDG_CONFIG ?= $(HOME)/.config/benchling-webhook` to Makefile
   - **Impact**: `npm run test:prod` now correctly reads deployment config

2. **Trailing Slash in Endpoint URLs** ([bin/commands/deploy.ts](../../bin/commands/deploy.ts), [bin/dev-deploy.ts](../../bin/dev-deploy.ts))
   - **Problem**: API Gateway URLs include trailing slashes, causing test URLs like `.../prod//event`
   - **Fix**: Strip trailing slash before storing endpoint: `webhookUrl.replace(/\/$/, "")`
   - **Impact**: Test URLs are now properly formatted

**Commit**: `22ea832` - fix(deployment): resolve XDG_CONFIG path and trailing slash issues
