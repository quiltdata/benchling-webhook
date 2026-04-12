# Why Per-Role TableWildcard Grants Also Failed

## Context

After discovering that IAM_ALLOWED_PRINCIPALS cannot be combined with
TableWildcard (see 02-table-wildcard.md), we tried granting TableWildcard
to each service role individually instead. This also failed.

## What we tried

Replaced the single IAM_ALLOWED_PRINCIPALS TableWildcard grant per database
with individual TableWildcard grants targeting each role's ARN. Nine grants
total: seven roles on UserAthenaDatabase, two on IcebergDatabase.

## What happened

All nine grants failed with AccessDeniedException:

"Resource does not exist or requester is not authorized to access
requested permissions."

## Why

To grant Lake Formation permissions to a role, the caller must itself be
a Lake Formation administrator. The CloudFormation execution role is not
a LF admin. It can grant IAM_ALLOWED_PRINCIPALS because that is a special
built-in mechanism that does not require LF admin status. But granting
permissions to real IAM roles does require LF admin status.

## What works and what doesn't

| Grant type | Principal | Result |
|---|---|---|
| Database-level | IAM_ALLOWED_PRINCIPALS | Works |
| Per-table (known CFN tables) | IAM_ALLOWED_PRINCIPALS | Works |
| TableWildcard | IAM_ALLOWED_PRINCIPALS | Rejected by AWS |
| TableWildcard | Real IAM role ARN | AccessDenied (not LF admin) |

## Remaining options

1. **Make the CFN execution role a Lake Formation admin.** Infrastructure
   change in Terraform, outside the stack template. Would unblock per-role
   grants.

2. **Restore CreateTableDefaultPermissions** at the account level to include
   IAM_ALLOWED_PRINCIPALS. New tables would automatically get IAM
   fallthrough. Risk: may conflict with whoever removed the defaults.

3. **Grant IAM_ALLOWED_PRINCIPALS per-table at creation time** in the
   Registry application code, every time it creates a Glue table.
