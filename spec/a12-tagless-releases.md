# A12: Safe Tagless Releases from Main

## Problem

The current change to `.github/workflows/ci.yaml` adds automatic production releases when a push to `main` changes `package.json` from one plain `x.y.z` version to another. It creates `v<version>` and then publishes Docker, GitHub, and npm artifacts in the same workflow run. This is necessary because a tag pushed with `GITHUB_TOKEN` does not start another workflow run, but the initial implementation has four release-safety defects:

1. **Tag pushes fail open.** A failed `git push origin refs/tags/$TAG` is treated as a possible race and exits successfully. The tag output stays empty, publication is silently skipped, and permission, authentication, ruleset, or network failures leave a green workflow with no release.
2. **Cancellation can still publish.** `always()` in the Docker and release job conditions can make irreversible publication eligible after the workflow is canceled.
3. **Shared latest pointers can move backward.** Overlapping release runs can complete out of order, allowing an older image to replace ECR `latest` and an older package to replace npm `latest`. Blindly canceling an active run is not safe because it can strand a release after only some artifacts have been published.
4. **Automatic tagging bypasses the project release contract.** The YAML shell block duplicates tag logic and relies on `test:ci`, while `npm run version:tag` requires `version:verify`, the full `npm test` suite, and the shared implementation in `scripts/version.ts`.

A main push with no version change is a normal no-release outcome. A release operation that was required but failed is an error. The workflow must represent those outcomes separately rather than using an absent tag output for both.

## Desired Solution and Implementation

### 1. Trigger and publication model

Keep both supported entry paths:

- A push of an existing `v*.*.*` tag runs the established tag-triggered release path.
- A push to `main` runs tests and asks project-owned version tooling whether the pushed commit contains a plain production version change. If so, that same run creates `v<version>` and continues through publication.

The automatic path must publish in the same run that creates the tag. A tag created with `GITHUB_TOKEN` does not emit a second workflow event, so waiting for a tag-triggered run would create a tag without Docker, GitHub, or npm artifacts.

Use an explicit release-decision contract from the auto-tag step, with outputs such as `outcome`, `release_required`, `tag`, and `target_sha`. Normal outcomes (`no-version-change`, `non-production-version`, or a verified pre-existing manual release) are successful no-ops. Once `release_required=true`, every unverified failure is fatal.

### 2. Project-owned tag selection and verification

Extend `scripts/version.ts` and `package.json` with one automatic-release command rather than implementing release semantics in YAML. The command must:

1. Resolve the before commit from the push payload, with the existing first-push fallback only when the payload commit is absent or unavailable.
2. Read the before and current `package.json` versions, require a real change, and require the current value to be plain `major.minor.patch`.
3. Derive exactly one tag, `v<current-version>`, and verify the intended commit is the checked-out `GITHUB_SHA`.
4. Apply the production gate before creating a tag: clean-tree verification, full `npm test`, and the same annotated-tag message and production semantics used by `npm run version:tag`.
5. Check both local and remote tag state. A pre-existing remote tag is acceptable only after fetching/dereferencing it and proving it points to the intended commit; otherwise fail.
6. On push failure, fail closed unless a fresh remote lookup proves the exact tag appeared during the attempted push and dereferences to the intended commit. Record that condition as an explicit verified race, not a generic success.
7. Emit machine-readable outputs for Actions and return nonzero for malformed versions, ambiguous history, mismatched tags, command failures, or unverifiable remote state.

Refactor the current tag helpers so manual `npm run version:tag`, automatic production tagging, and tests call shared TypeScript functions. Keep `npm run version:tag:dev` timestamp generation unchanged. Do not use `npm version`; version bumps remain `npm run version -- patch|minor|major`, and this repair does not bump a version.

For a tag-triggered run, resolve the pushed tag through the same project-owned validation code. Verify that the tag dereferences to the checked-out commit and that its production or timestamp-prerelease form matches the package version before any publication begins.

### 3. Cancellation-aware dependencies

A canceled workflow must never become newly eligible for an irreversible step. Replace broad `always()` predicates with cancellation-aware and result-aware conditions:

- The publish path requires `!cancelled()`, `needs.test.result == 'success'`, a verified tag, and an `autotag` result of either `success` or the expected `skipped` state for direct tag events.
- Downstream publication requires the preceding publication phase to have succeeded and `!cancelled()`.
- Use ordinary dependency success semantics where a status function is not needed. Retain a status function only where Actions would otherwise suppress a job because `autotag` was intentionally skipped on tag events.

Cancellation is a stop-before-next-side-effect rule. It does not cancel an already active production publisher merely to admit a newer run.

### 4. Serialized, monotonic, retry-safe publication

Treat Docker, GitHub Release, and npm publication as one release transaction. Put the irreversible publication sequence in one job, or one reusable workflow invoked as a single job, so a single concurrency lock covers the whole sequence rather than releasing a lock between Docker and npm. Production publication uses one repository-wide concurrency group with `cancel-in-progress: false`. Direct production tags and automatic main releases use the same group; pending superseded work may be replaced, but an active publisher is allowed to finish.

Serialization prevents simultaneous writers but does not guarantee queue order, so add channel-specific stale guards:

- **ECR:** first publish the immutable version tag without changing `latest`. Extend `docker/scripts/docker.py` and `docker/make.deploy` with a tested project-owned promotion command that reads the current `latest` digest and its associated release tag, compares release order, and uses an ECR manifest retag only when the candidate is newer. Missing `latest` may be initialized; an unreadable, unversioned, or ambiguous current pointer fails closed. Production versions use semantic-version ordering. Timestamp prereleases remain supported and are ordered by semantic base and timestamp, while a stable release outranks prereleases of the same base version.
- **npm:** use a project-owned TypeScript publisher that checks whether the immutable package version already exists, publishes a missing version under a unique temporary dist-tag, and moves npm `latest` only when the production candidate is strictly newer than the registry's current plain semantic version. Remove the temporary tag after promotion. Registry lookup, comparison, publish, promotion, and cleanup errors fail the job; reruns tolerate an already-published immutable version.
- **GitHub Release:** create or update the release idempotently for the verified tag so a retry can complete a partially published release without duplicating it.

The stale checks run while holding the publication lock and immediately before moving each shared pointer. Older queued releases may complete missing immutable artifacts, but they must not move either `latest` pointer backward. This is preferable to canceling a partially published run and provides a repair path after transient failures.

The centralized production image remains `712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:latest`. No package prefix is added to CI or infrastructure; `pkg_prefix` remains a runtime secret.

### 5. Backward compatibility

- `npm run version:tag` still performs clean-tree verification, full `npm test`, and creates/pushes `v<version>` production tags.
- `npm run version:tag:dev` still creates unique timestamped prerelease tags and the workflow still publishes their immutable Docker image, GitHub prerelease, and npm `dev` package.
- Existing direct production tag pushes remain valid and use the same verification and publication transaction as automatically created tags.
- A manually created tag discovered by the main workflow is skipped only after its commit target is verified. A mismatched tag is a hard failure.
- A main push without a version change remains green and publishes nothing. No repair step creates or pushes a real version tag during local validation.

### 6. Fail-closed behavior

The release path must fail visibly on unknown state: inability to read history, malformed versions, tag-target mismatch, unverified tag push failure, canceled or failed prerequisites, unreadable registry state, ambiguous ECR `latest`, failed npm comparison, or failed shared-pointer promotion. A rerun may safely continue because immutable artifacts and GitHub releases are handled idempotently, but no error may be converted into a green no-release result.

## Implementation Plan

1. Move version-change detection, tag derivation, tag-target verification, full release gating, and race handling into exported/testable helpers in `scripts/version.ts`; expose the automatic command through `package.json` and reduce `autotag` YAML to setup plus command invocation.
2. Reshape `.github/workflows/ci.yaml` so verified direct tags and verified automatic tags feed one cancellation-aware publication transaction protected by non-canceling production concurrency.
3. Split immutable ECR publication from guarded `latest` promotion in `docker/scripts/docker.py` and `docker/make.deploy`, then add the retry-safe npm publisher and wire both guards into the locked publication job.
4. Add focused unit tests for tag decisions, push-race verification, cancellation/result predicates where statically testable, semantic ordering, ECR promotion, npm stale/version-exists handling, and fail-closed errors; then run the repository quality gates without creating tags or publishing artifacts.

## Tasks and Checklist

A checkbox is marked complete only when its named evidence exists. If implementation fails, leave the affected item unchecked and record the failure; this checklist is complete only after all repairs and quality gates succeed.

### (i) Baseline documentation, commit, and push

- [ ] Confirm `git -C /Users/ernest/GitHub/benchling-webhook status --short --branch` shows branch `tagless-releases` and preserves the user's `.github/workflows/ci.yaml` and `AGENTS.md` changes.
- [ ] Confirm `git -C /Users/ernest/GitHub/benchling-webhook diff --exit-code origin/auto-release-docs -- AGENTS.md` succeeds, proving `AGENTS.md` matches the requested branch copy.
- [ ] Confirm the accidental root `semantic-review/` directory is absent and no replacement `semantic-review` directory exists.
- [ ] Review the baseline CI diff against `main` and record the four defects from this specification before repair.
- [ ] Run `git -C /Users/ernest/GitHub/benchling-webhook diff --check`; require no whitespace errors.
- [ ] Commit only the baseline CI change, imported `AGENTS.md`, and `spec/a12-tagless-releases.md` with a conventional documentation/change message; do not include cache, generated, environment, or secret files.
- [ ] Push branch `tagless-releases` to origin and record the successful push output before beginning Repair 1. Do not create or push a version tag.

### (ii) Repair 1 — fail-closed tag push

- [ ] Refactor `scripts/version.ts` so production tag construction, annotated tag creation, local/remote existence checks, and commit dereferencing are shared by manual and automatic paths.
- [ ] Add the automatic release command to `package.json`; keep `version:tag` and `version:tag:dev` behavior intact and keep the full `npm test` gate inside the automatic release contract.
- [ ] Replace YAML-only version detection/tagging in `.github/workflows/ci.yaml` with the project command and explicit outputs for no change, verified existing tag, created tag, verified race, and failure.
- [ ] Verify a no-version-change fixture exits successfully with `release_required=false` and no tag operation.
- [ ] Verify a production version bump fixture selects only `v<package-version>` and requires it to target the fixture's intended commit.
- [ ] Verify a generic simulated push failure exits nonzero and cannot produce a publishable tag output.
- [ ] Verify the only accepted push race is a newly observed remote tag that dereferences to the intended commit; a different commit, missing peeled target, or lookup failure exits nonzero.
- [ ] Verify pre-existing manual production tags are accepted/skipped only when they dereference to the intended commit.
- [ ] Run the focused TypeScript release tests with `npm run test:unit -- --runTestsByPath test/unit/version-release.test.ts`; require all cases to pass without contacting or modifying origin.

### (iii) Repair 2 — cancellation-aware publish

- [ ] Remove unnecessary `always()` usage from publication conditions in `.github/workflows/ci.yaml`.
- [ ] Require `!cancelled()`, successful tests, a verified tag, and explicit expected `autotag` results before publication can start.
- [ ] Require each later irreversible phase to have a successful predecessor and a non-canceled workflow.
- [ ] Add static workflow tests or a repository-owned workflow validation script covering direct tag, automatic tag, unchanged main push, failed test, skipped autotag, failed autotag, and canceled run eligibility.
- [ ] Run the focused workflow tests and require canceled/failed scenarios to be ineligible while both valid trigger paths remain eligible.

### (iv) Repair 3 — concurrency and monotonic latest guard

- [ ] Place the complete irreversible publication transaction under one production concurrency group with `cancel-in-progress: false`; ensure an active publisher cannot be canceled by a newer release.
- [ ] Ensure automatic main releases and manual production-tag releases share the lock, while pull requests and ordinary non-release work do not contend for it.
- [ ] Change the Docker build path to publish the immutable version tag before any `latest` update.
- [ ] Add the ECR promotion command to `docker/scripts/docker.py` and `docker/make.deploy`, using the centralized `712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling` repository and server-side manifest retagging.
- [ ] Unit-test ECR promotion for missing latest, newer candidate, equal candidate, stale candidate, timestamp prerelease ordering, stable-over-same-base-prerelease ordering, ambiguous current tags, AWS lookup failure, and put failure.
- [ ] Add the project-owned npm publisher with exact semantic comparison, already-published-version recovery, unique temporary tag publication, guarded `latest` promotion, and temporary-tag cleanup.
- [ ] Unit-test npm publication for missing version, existing version after partial failure, newer/equal/stale candidate, malformed registry response, lookup failure, publish failure, promotion failure, and cleanup failure.
- [ ] Verify a simulated newer-first/older-second sequence leaves both immutable versions available and leaves ECR/npm `latest` on the newer version.
- [ ] Verify retries after each simulated partial-publication boundary complete missing artifacts without moving either shared pointer backward.
- [ ] Run `cd docker && uv run pytest tests/test_docker_release.py -v` and the focused npm publisher test command; require all guard and failure cases to pass with mocked registries.

### (v) Repair 4 — route automatic tagging through project-owned scripts

- [ ] Confirm `.github/workflows/ci.yaml` contains no duplicated shell implementation of semantic-version parsing, tag creation, or push-race interpretation.
- [ ] Confirm the automatic path invokes the package script and that the package script enforces clean-tree verification, full `npm test`, and shared `scripts/version.ts` tag semantics.
- [ ] Confirm direct production tags are validated by the same project-owned release-context helper before publication.
- [ ] Confirm `npm run version:tag` still maps to `version:verify`, full `npm test`, and production tagging, and `npm run version:tag:dev` still maps to the timestamped prerelease implementation.
- [ ] Run automatic-tag tests for malformed version, missing before commit, unavailable history fallback, tag mismatch, and verified success; require deterministic explicit outcomes.

### (vi) Validation

- [ ] Run `git -C /Users/ernest/GitHub/benchling-webhook diff --check`; require no errors.
- [ ] Run the available YAML/Actions-aware validator against `.github/workflows/ci.yaml` (prefer repository tooling; otherwise `yamllint .github/workflows/ci.yaml` plus an installed `actionlint`) and record any unavailable validator explicitly.
- [ ] Run `npm run build:typecheck`; require zero TypeScript diagnostics.
- [ ] Run all focused TypeScript and Python release tests; require all pass.
- [ ] Run `npm test` before each implementation commit; require lint, typecheck, TypeScript tests, and Python tests to pass.
- [ ] Because Docker publication tooling changed, run `npm run test:local`; if the change affects the production-container path, also run `npm run test:local:prod`. Require successful smoke tests or record an environmental blocker without marking complete.
- [ ] Run `npm run test:integration` before merge readiness; require all integration tests to pass.
- [ ] Confirm validation created no git tags, made no registry publication, did not trigger a production release, did not change versions, and did not modify any `.env` file.
- [ ] Inspect `git -C /Users/ernest/GitHub/benchling-webhook status --short` and exclude generated, cache, environment, credential, and secret files from commits.

### (vii) Independent review

- [ ] Have an independent reviewer compare the complete branch diff with this A12 specification and all four original findings.
- [ ] Require the reviewer to inspect fail-closed exits, commit/tag verification, cancellation predicates, lock scope, stale ordering, partial-failure recovery, and manual/dev compatibility rather than relying only on passing tests.
- [ ] Store each review verdict at `.agents/tasks/tagless-releases/verdict.json` with `{"verdict":"APPROVED"}` or `{"verdict":"CHANGES_REQUESTED"}`; do not place review artifacts under `spec/` or repository root.
- [ ] Resolve every `CHANGES_REQUESTED` finding and rerun the affected focused tests plus `npm test` before requesting another review.
- [ ] Mark this section complete only after the independent verdict is `APPROVED`.

### (viii) Checklist reconciliation

- [ ] Reconcile every checkbox against command output, test output, commit history, or reviewer evidence; do not mark inferred work complete.
- [ ] Update implementation notes in this file only when the final code differs materially from the desired implementation, and explain why the safety guarantees remain satisfied.
- [ ] Confirm all four repairs are represented in the final diff and no unrelated behavior or tests were added.
- [ ] Confirm the centralized ECR URI remains `712023778557.dkr.ecr.us-east-1.amazonaws.com/quiltdata/benchling:latest` where the runtime image applies and `pkg_prefix` remains runtime-only.

### (ix) Final commit and push

- [ ] Run final `npm test` and `npm run test:integration`; require both to pass immediately before finalization.
- [ ] Commit the repaired implementation, focused tests, and reconciled A12 checklist using specific file staging; do not amend a failed-hook commit and do not commit `.agents/` review artifacts.
- [ ] Push `tagless-releases` to origin without force and record the resulting remote commit SHA.
- [ ] Confirm `git -C /Users/ernest/GitHub/benchling-webhook status --short --branch` is clean and tracking the pushed branch.
- [ ] Confirm no production or dev version tag was created or pushed during repair and no production publication was used as validation.
