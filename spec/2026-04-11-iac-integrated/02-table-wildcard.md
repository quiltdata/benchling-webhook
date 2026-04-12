# TableWildcard Grant Failure

## Why we thought we needed it

When Lake Formation enforcement is active (IAMAllowedPrincipals removed from
both CreateDatabaseDefaultPermissions and CreateTableDefaultPermissions),
IAM-only roles lose access to Glue tables even with correct IAM policies.

Database-level LF grants restore access to the database itself, but not to
tables inside it. We added TableWildcard grants to cover:

- **Dynamically-created tables** (per-bucket views in UserAthenaDatabase)
  that don't exist at deploy time and can't have individual CFN grants.
- **Iceberg tables** (package_revision, package_entry, etc.) which are also
  created at runtime, not CFN-managed.

## Attempt 1: IAM_ALLOWED_PRINCIPALS + TableWildcard

AWS Lake Formation rejects this combination. IAM_ALLOWED_PRINCIPALS is a
special principal that opts resources out of LF control, and AWS does not
allow it with TableWildcard.

Error: "Grant on table wildcard is not allowed"

## Attempt 2: Per-role TableWildcard grants

Replaced IAM_ALLOWED_PRINCIPALS with per-role grants (GetAtt role ARN).
TableWildcard works for normal roles, but the CFN execution role is not a
Lake Formation admin, so it cannot grant LF permissions to other roles.

Error: "Resource does not exist or requester is not authorized to access
requested permissions" (AccessDeniedException, 9 failures — one per grant)

## What actually works

- Database-level IAM_ALLOWED_PRINCIPALS grants — yes
- Per-table IAM_ALLOWED_PRINCIPALS grants (known CFN tables) — yes
- TableWildcard with IAM_ALLOWED_PRINCIPALS — no
- TableWildcard with real roles (without LF admin) — no

## Remaining options for dynamic tables

1. **Restore CreateTableDefaultPermissions** at the account level via
   AWS::LakeFormation::DataLakeSettings to include IAM_ALLOWED_PRINCIPALS.
   New tables would automatically get IAM fallthrough. Risk: conflicts with
   whoever removed the defaults, and requires the CFN role to be LF admin.

2. **Grant IAM_ALLOWED_PRINCIPALS per-table at creation time** in the
   application code (Registry service). Every time the registry creates a
   Glue table, it also calls lakeformation:PutDataLakeSettings or
   lakeformation:GrantPermissions for that table.

3. **Make the CFN execution role a Lake Formation admin** so it can issue
   per-role grants. This is an infrastructure/Terraform change outside the
   stack template.
