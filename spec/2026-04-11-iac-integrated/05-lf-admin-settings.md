# Lake Formation Admin Settings — Resolution

## Starting state

Caller: ernest-staging (IAM user, account 712023778557, us-east-2)

LF admin list: ernest-staging, sus-test-provisioning, sus-test-managed-access,
sergey, kevin-staging. GitHub-Deployment was NOT on the list.

CreateDatabaseDefaultPermissions: empty (LF enforced by sus-test)
CreateTableDefaultPermissions: empty (LF enforced by sus-test)

## Why ernest-staging couldn't call PutDataLakeSettings

Despite having AdministratorAccess AND being an LF admin, the `quilt-admins`
IAM group has the AWS managed policy `AWSLakeFormationDataAdmin` attached.
That policy contains an explicit deny on `lakeformation:PutDataLakeSettings`.
Explicit deny always wins.

## How we unblocked it

1. Temporarily removed ernest-staging from quilt-admins group
2. Called PutDataLakeSettings to add GitHub-Deployment to LF admin list
   (first attempt had wrong ARN — the role has path `/github/`, so the
   correct ARN is `arn:aws:iam::712023778557:role/github/GitHub-Deployment`)
3. Restored ernest-staging to quilt-admins group

## Current LF admin list

- ernest-staging
- sus-test-provisioning
- sus-test-managed-access
- sergey
- kevin-staging
- **GitHub-Deployment** (newly added)

## Result

Re-ran the CloudFormation deployment (run 24295014989). All per-role
TableWildcard grants deployed successfully. Confirmed 2026-04-11.
