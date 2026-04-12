# The Lake Formation Admin List Is the Real Blocker

## Why

Lake Formation maintains its own admin list, separate from IAM. Even a role
with AdministratorAccess cannot grant LF permissions, modify LF settings, or
change table defaults unless it is on that list. Every approach we've tried
— TableWildcard with IAM_ALLOWED_PRINCIPALS, per-role grants, restoring
table defaults — fails because no role in our infrastructure is an LF admin.

Someone (likely the sus-test stack) enabled LF enforcement and removed
IAM_ALLOWED_PRINCIPALS from the account defaults. That's valid. But it left
us with no way to manage LF grants from CloudFormation or application code.

## Options for getting onto the LF admin list

### A. Add the GitHub-Deployment role as LF admin

The OIDC role that runs Terraform already has AdministratorAccess. Adding it
to the LF admin list would let the CFN stack issue per-role TableWildcard
grants.

**Pro:** Minimal blast radius — one role, already has full IAM power.
**Con:** Requires a one-time manual console action or a bootstrap step
outside Terraform (since Terraform itself can't modify LF settings without
already being an admin). Chicken-and-egg.

### B. Add the CFN execution role as LF admin

If CloudFormation uses a separate execution role (not the deployment role),
that role would need to be on the list instead.

**Pro:** Scoped to CFN operations only.
**Con:** Same chicken-and-egg problem. Also need to confirm which role CFN
actually uses — it may just be the deployment role.

### C. Add the Registry ECS task role as LF admin

The Registry already creates dynamic Glue tables at runtime. If it were an
LF admin, it could grant IAM_ALLOWED_PRINCIPALS on each table at creation
time.

**Pro:** Grants happen at the right moment — when tables are created.
**Con:** Gives a long-running application role LF admin powers, which is a
broader privilege than it needs for its day job. Also requires application
code changes in the Registry.

## The chicken-and-egg problem

To add a role to the LF admin list, you must already be an LF admin (or the
account root). Since no automation role is currently an LF admin, the first
addition must be done manually via the AWS console or by the root user.
After that, Terraform or CFN can manage the list going forward.

## Recommendation

Option A is the simplest path. One manual console action to bootstrap, then
Terraform manages it from there. The deployment role already has full IAM
power — adding LF admin doesn't meaningfully expand its blast radius.
