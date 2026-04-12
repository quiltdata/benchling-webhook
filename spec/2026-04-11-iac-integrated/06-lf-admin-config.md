# Lake Formation Grants Must Be Opt-In

## Scope

This spec is about **Athena and Iceberg database access** under Lake
Formation enforcement. It has nothing to do with Benchling. The affected
databases are:

- **UserAthenaDatabase** — per-bucket Athena tables created dynamically
  by the Registry at runtime
- **IcebergDatabase** — package_revision, package_entry, etc. created
  at runtime by the Iceberg Lambda

When Lake Formation enforcement is active at the account level, roles
lose access to dynamically-created tables in these databases unless they
have explicit LF grants. The grants that restore access (per-role
TableWildcard) require the deploying role to be an LF admin — a
prerequisite that varies by account and cannot be assumed.

## Problem

`lakeformation.py:add_iam_fallthrough()` unconditionally emits per-role
TableWildcard grants for UserAthenaDatabase and IcebergDatabase. These
grants require the CloudFormation execution role to be a Lake Formation
admin (spec 03, 04, 05). If it isn't, the stack fails with
AccessDeniedException on every TableWildcard `AWS::LakeFormation::Permissions`
resource.

This means **any account that hasn't completed the manual LF admin
bootstrap (spec 04, 05) will fail to deploy**. That includes:

- New customer installs (no LF admin list setup yet)
- Accounts that don't use LF enforcement at all
- Accounts where a different role (not the CFN role) is the LF admin
- Any deployment where the LF admin prerequisite hasn't been met

The per-role TableWildcard grants are only needed when:

1. LF enforcement is active (IAM_ALLOWED_PRINCIPALS removed from defaults)
2. The stack creates databases with dynamically-created tables
3. The deploying role has been added to the LF admin list

All three conditions are account-specific. Baking the grants in
unconditionally turns a per-account prerequisite into a universal
deployment blocker.

## Solution

Gate the per-role TableWildcard grants behind an opt-in CloudFormation
parameter. Default to `Disabled`. Terraform sets it to `Enabled` only
after the deploying role has been confirmed as an LF admin.

## Tasks

### 1. Add CFT parameter `EnableLakeFormationGrants`

- Add a `Parameter` to the Quilt stack template:
  - Name: `EnableLakeFormationGrants`
  - Type: `String`
  - AllowedValues: `Enabled`, `Disabled`
  - Default: `Disabled`
  - Description: "Enable per-role Lake Formation TableWildcard grants.
    Requires the CloudFormation execution role to be a Lake Formation
    administrator. Leave Disabled unless LF enforcement is active and
    the deploying role is on the LF admin list."
- Add a corresponding CFN condition: `LakeFormationGrantsEnabled`

### 2. Gate TableWildcard grants on the new condition

`lakeformation.py` is troposphere code that runs at **build time** to
emit a CFN template. A CFN condition is evaluated at **deploy time**.
You cannot use a CFN condition to skip a Python loop — the resources
must be emitted into the template with a `Condition` attached so
CloudFormation skips them at deploy time.

The existing pattern (see `benchling.py:42-49`, `lakeformation.py:113-117`):

```python
# benchling.py:42 — define the condition
cft.add_condition("BenchlingEnabled", Equals(param.ref(), "Enabled"))

# benchling.py:49 — attach to each resource
ec2.SecurityGroup(..., Condition="BenchlingEnabled")

# lakeformation.py:116-117 — attach condition to grant after creation
if hasattr(role_resource, "Condition"):
    perm.Condition = role_resource.Condition
```

Implementation for `lakeformation.py:add_iam_fallthrough()`:

- The function already receives `cft`. Add the `EnableLakeFormationGrants`
  parameter and `LakeFormationGrantsEnabled` condition at the top of
  `add_iam_fallthrough()` (or in the caller that sets up parameters).
- In the `_DYNAMIC_DB_ROLE_GRANTS` loop (`lakeformation.py:90-119`),
  attach `Condition="LakeFormationGrantsEnabled"` to every emitted
  `lakeformation.Permissions` resource. For roles that already have
  their own condition (e.g. `BenchlingEnabled`), the condition must be
  the existing role condition — but since the entire grant is only
  relevant when LF grants are enabled, those roles' grants should
  not exist at all when LF grants are disabled. Use `troposphere.And`
  to combine: `perm.Condition = "LFAndRoleCondition"` where that
  condition is defined as `And(Condition("LakeFormationGrantsEnabled"), Condition(...))`.
- Database-level and per-table IAM_ALLOWED_PRINCIPALS grants
  (`lakeformation.py:66-85`, `124-142`) remain unconditional — they
  don't require LF admin and don't fail.

### 3. Add Terraform variable and wiring — DONE

**PR:** quiltdata/iac#104

- Added `enable_lf_grants` (bool, default `false`) to `modules/quilt/variables.tf`
- Wired to CFT parameter in `modules/quilt/main.tf`:
  `EnableLakeFormationGrants = var.enable_lf_grants ? "Enabled" : "Disabled"`
- Documented in `VARIABLES.md` under "Lake Formation Variables"
- Operators must set `enable_lf_grants = true` only after adding the
  deploying role to the LF admin list (manual console step or bootstrap
  script).

### 4. Test with auto-stack-dev before merging

The `bench` workspace in `tf/auto-stack-dev` is the deployment that
needs LF grants (account 712023778557, us-east-2, where LF enforcement
is active and GitHub-Deployment is already an LF admin per spec 05).

#### Setup

1. In `deployment/tf/auto-stack-dev/main.tf`, temporarily change the
   module source ref to point at the branch:

   ```hcl
   source = "github.com/quiltdata/iac//modules/quilt?ref=2026-04-11-enable-lf-grants"
   ```

   (currently `?ref=f03d8505cd412d6847203bdde8244b92d483c8fc`)
2. Run `terraform init -upgrade` to pull the branch ref.

#### Test A: Disabled (default) — LF grants skipped at deploy time

1. Do NOT add `enable_lf_grants` (or set it explicitly to `false`).
2. Run `terraform plan` in the `bench` workspace.
3. Verify that `EnableLakeFormationGrants = Disabled` appears in the
   parameter list.
4. Inspect the generated CFT and confirm the `*TableWildcardLF`
   resources are **present** in the template but each has
   `Condition: LakeFormationGrantsEnabled` (or a combined condition
   for roles that have their own condition). The resources are always
   emitted — CloudFormation skips them at deploy time when the
   condition is false.
5. Run `terraform apply` and confirm the stack update succeeds
   without creating any `AWS::LakeFormation::Permissions`
   TableWildcard resources (no AccessDeniedException, no LF grants
   in the console).

#### Test B: Enabled — LF grants deploy successfully

1. Add `enable_lf_grants = true` to the module block.
2. Run `terraform plan` in the `bench` workspace.
3. Verify that `EnableLakeFormationGrants = Enabled` appears in the
   parameter list.
4. Run `terraform apply` to deploy the stack update.
5. Confirm the CloudFormation stack update succeeds — all per-role
   TableWildcard `AWS::LakeFormation::Permissions` resources
   (e.g. `UserAthenaDatabaseAmazonECSTaskExecutionRoleTableWildcardLF`,
   `IcebergDatabaseIcebergLambdaRoleTableWildcardLF`, etc.) create
   without AccessDeniedException.
6. Spot-check in the AWS console (Lake Formation > Data permissions)
   that the expected roles have TableWildcard grants on
   UserAthenaDatabase and IcebergDatabase.

#### Cleanup

1. Revert the source ref change — the real merge will use a commit
   SHA or tag on main.

### 5. Document the bootstrap sequence

- Update deployment docs to include the correct order of operations:
  1. Deploy stack with `EnableLakeFormationGrants = Disabled` (default)
  2. Add the CFN execution role to the LF admin list (manual/console)
  3. Set `enable_lf_grants = true` in Terraform and redeploy
- Note: steps 2-3 are only needed when LF enforcement is active.
  Accounts without LF enforcement can leave the parameter disabled
  permanently with no loss of functionality (IAM policies are
  sufficient).

### 6. Verify no other LF-admin-dependent resources leak through

- Audit `lakeformation.py` for any other resources that implicitly
  require LF admin privileges (e.g. `DataLakeSettings` modifications).
- Confirm that database-level `IAM_ALLOWED_PRINCIPALS` grants and
  per-table `IAM_ALLOWED_PRINCIPALS` grants do NOT require LF admin
  (they use the built-in IAM fallthrough mechanism).
- If any are found, gate them behind the same condition.

## Non-goals

- Automating the LF admin bootstrap (chicken-and-egg problem from
  spec 04 remains manual by design).
- Standalone benchling-webhook CDK stack — it doesn't manage Athena
  or Iceberg databases and has no LF grants. If it ever adds them,
  gate behind a similar opt-in parameter at that time.
- Modifying account-level `DataLakeSettings` (CreateTableDefaultPermissions
  etc.) from the stack template.
