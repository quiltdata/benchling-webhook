# Follow-On: Lambda Authorizer Bundling & Local Validation

**Date**: 2025-11-26  
**Context**: Deployment blocked locally (via `npx` CDK) because Lambda authorizer bundle fails (`docker ... public.ecr.aws/sam/build-python3.11 ... unexpected EOF`). CI is not the path; we must make local bundling deterministic and testable.

---

## Problems Observed

- CDK asset bundling for `lambda/authorizer` exits 125 with an unexpected EOF from the SAM Python 3.11 image; deployment cannot proceed.
- No preflight command exists to exercise the same bundling path locally before `cdk deploy`.
- Authorizer correctness (headers, HMAC, Secrets Manager fetch) is untested post-bundle; failures surface only at deploy time.

---

## Requirements (Local-First)

1. **Deterministic bundling (no flake, no internet surprises)**  
   - Pin `benchling-sdk` and transitive deps; prefer `pip install --require-hashes`.  
   - Provide an optional local wheel cache or vendored wheels to avoid network fetch during bundle.  
   - Support containerized bundling parity with Lambda runtime (`public.ecr.aws/sam/build-python3.11`) and a fallback non-Docker path when Docker is unavailable, while keeping behavior consistent.

2. **Local bundle test command (blocking)**  
   - Add `npm run test:lambda-bundle` (or similar) that replicates CDK bundling flags and outputs the bundle artifact path.  
   - Command must fail fast on missing deps, pip errors, or empty artifact.  
   - Emit logs to a known location for debugging (`cdk.out/authorizer-bundle.log`).

3. **Authorizer contract tests (post-bundle)**  
   - Load the packaged artifact and invoke the handler with mocked Secrets Manager:
     - Valid signature → Allow
     - Invalid/missing headers → Deny
     - Expired timestamp → Deny
     - Secrets Manager failure → Deny  
   - Ensure the packaged code can import `benchling-sdk` from the bundle.

4. **No CI dependency**  
   - All remediation must run locally via `npx`/npm scripts; do not assume CI runners or caches.

5. **Documentation update**  
   - Document the local bundle/test workflow in `README`/`WORKFLOW` or a short ops note so developers can reproduce before running `cdk deploy`.

---

## Acceptance Criteria

- `npm run test:lambda-bundle` succeeds locally and produces a bundle used by CDK without re-downloading dependencies on retry.  
- Authorizer contract tests execute against the packaged artifact and pass.  
- A failed bundle or missing dependency fails before `cdk synth/deploy` begins.  
- Deployment via `npx cdk deploy ...` no longer fails on the authorizer bundling step.  
- Updated docs describe the local bundle/test flow. 
