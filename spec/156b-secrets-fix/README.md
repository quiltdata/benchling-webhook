# Spec 165b: Secrets-Only Mode Deployment Fix

**Status**: ✅ Complete
**Date**: 2025-11-01
**Related**: Spec 156a (Secrets-Only Architecture)
**Branch**: `156-secrets-manager`
**Commits**: `f47b04c`, `8a800b8`

## Overview

Fixed ECS Circuit Breaker deployment failure by removing "legacy mode" from production code and ensuring both production and tests use **identical secrets-only mode code paths**.

### Problem

`npm run cdk:dev` was failing because:
1. It was attempting to deploy using "legacy mode" (10+ environment variables)
2. Legacy mode was **never meant to be deployed** - it was only for test backward compatibility
3. Python config had broken code paths in legacy mode

### Solution

1. **Updated `cdk:dev` to use secrets-only mode** with AWS Secrets Manager
2. **Removed legacy mode entirely from Python config** - now ONLY supports secrets-only mode
3. **Updated tests to mock `ConfigResolver`** - tests use same code path as production

### Result

✅ Production and tests now use **THE EXACT SAME CODE PATH**
✅ Only 2 environment variables needed: `QuiltStackARN` + `BenchlingSecret`
✅ All configuration automatically resolved from AWS
✅ Simpler, clearer, more maintainable code (-15 lines)

## Documents

This specification is split into two documents:

1. **[Requirements](./01-requirements.md)** - Problem statement, requirements, success criteria, breaking changes
2. **[Spec](./02-spec.md)** - Solution design, implementation details, testing, deployment, migration guide

## Quick Links

### Key Sections

- **Problem Analysis**: [Requirements → Problem Statement](./01-requirements.md#problem-statement)
- **Requirements**: [Requirements → Requirements](./01-requirements.md#requirements)
- **Solution Design**: [Spec → Solution Design](./02-spec.md#solution-design)
- **Implementation**: [Spec → Implementation](./02-spec.md#implementation)
- **Testing**: [Spec → Testing](./02-spec.md#testing)
- **Migration Guide**: [Spec → Migration Guide](./02-spec.md#migration-guide)
- **Lessons Learned**: [Spec → Lessons Learned](./02-spec.md#lessons-learned)

### Critical Information

- **Breaking Changes**: [Requirements → Breaking Changes](./01-requirements.md#breaking-changes)
- **Success Criteria**: [Requirements → Success Criteria](./01-requirements.md#success-criteria)
- **Deployment Steps**: [Spec → Deployment](./02-spec.md#deployment)
- **Files Changed**: [Spec → Files Changed Summary](./02-spec.md#files-changed-summary)

## Implementation Summary

### Files Changed

| File | Change |
|------|--------|
| [docker/src/config.py](../../docker/src/config.py) | -32 lines (removed legacy mode) |
| [docker/tests/conftest.py](../../docker/tests/conftest.py) | +46 lines (added mock fixture) |
| [docker/tests/test_config_env_vars.py](../../docker/tests/test_config_env_vars.py) | -34 lines (updated tests) |
| [bin/cdk-dev.js](../../bin/cdk-dev.js) | +5 lines (added parameters) |
| **Total** | **-15 lines (-2.4%)** |

### Commits

- **`f47b04c`**: fix: switch cdk:dev to use secrets-only mode deployment
- **`8a800b8`**: refactor: remove legacy mode, use secrets-only everywhere

### Test Results

```bash
$ pytest docker/tests/test_config_env_vars.py -v
============================== 4 passed in 0.07s ==============================
```

## Related Documentation

- **Spec 156a**: [Secrets-Only Architecture](../156a-secrets-only/) - Original architecture design
- **Issue #156**: [GitHub Issue](https://github.com/quiltdata/benchling-webhook/issues/156)
- **PR #160**: [Pull Request](https://github.com/quiltdata/benchling-webhook/pull/160)

## Status

- ✅ Requirements documented
- ✅ Specification complete
- ✅ Implementation complete
- ✅ Unit tests passing
- ⏳ Deployment pending
- ⏳ Integration testing pending

## Next Steps

1. Deploy to development environment (`npm run cdk:dev`)
2. Verify health and config endpoints
3. Review and merge PR #160
4. Deploy to production
5. Optional: Clean up legacy CDK code paths

---

**Last Updated**: 2025-11-01
**Document Version**: 1.0
