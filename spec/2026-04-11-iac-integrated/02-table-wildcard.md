# TableWildcard Grant Failure

## Why we thought we needed it

When Lake Formation enforcement is active (IAMAllowedPrincipals removed from
both CreateDatabaseDefaultPermissions and CreateTableDefaultPermissions),
IAM-only roles lose access to Glue tables even with correct IAM policies.

Database-level LF grants restore access to the database itself, but not to
tables inside it. We added TableWildcard grants to cover:

- **Dynamically-created tables** (per-bucket views in UserAthenaDatabase)
  that don't exist at deploy time and can't have individual CFN grants.
- **Iceberg tables** (package_revision, package_entry, etc.) which are
  CFN-managed but weren't listed in the per-table grants.

## Why it didn't work

AWS Lake Formation rejects TableWildcard grants for the IAM_ALLOWED_PRINCIPALS
principal. This is an AWS-side restriction: IAM_ALLOWED_PRINCIPALS is a special
principal that opts resources out of LF control, and AWS does not allow it to be
combined with TableWildcard. The grant works for normal principals/roles, but
not for this opt-out mechanism.

## What to do instead

Both fixes are needed — once LF enforcement is active, every Glue path hits LF.

1. **CFN-managed tables** (Iceberg, NamedPackages, AuditTrail): add explicit
   per-table IAM_ALLOWED_PRINCIPALS grants for each.

2. **Dynamically-created tables** (UserAthenaDatabase views): replace the
   IAM_ALLOWED_PRINCIPALS TableWildcard grants with per-role TableWildcard
   grants. TableWildcard itself is fine — the restriction is only on
   combining it with IAM_ALLOWED_PRINCIPALS.

   Roles that need UserAthenaDatabase TableWildcard grants:
   - **AmazonECSTaskExecutionRole** (Registry) — creates/updates/deletes tables
   - **BenchlingTaskRole** — queries tables via Athena
   - **IcebergLambdaRole** — queries tables via Athena
   - **TabulatorOpenQueryRole** — queries tables via Athena
   - **T4BucketReadRole** — queries tables (user-facing)
   - **T4BucketWriteRole** — queries tables (user-facing)
   - **ManagedUserRole** — queries tables (user-facing)
