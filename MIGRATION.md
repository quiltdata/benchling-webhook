# Migration Guide: 0.9.0 (HTTP API + VPC Link)

This release replaces the REST API + ALB architecture with an HTTP API that connects to ECS through a VPC Link and Cloud Map. The FastAPI service now listens on port **8080**. These changes require a fresh stack because REST and HTTP APIs cannot be swapped in-place.

## Automatic Detection

**v0.9.0 automatically detects v0.8.x stacks** and prevents in-place updates. If you attempt to deploy v0.9.0 over a v0.8.x stack, the deployment will fail with clear instructions on how to migrate safely.

## What Changed

- API Gateway **HTTP API** + **VPC Link** + **Cloud Map** replace REST API + ALB
- Fargate tasks register in `benchling.local` and serve Flask on port **8080**
- New API access log group: `/aws/apigateway/benchling-webhook-http`
- ALB resources (listeners, target groups, log bucket) removed

## Upgrade Steps

1. **Prepare downtime window**: the stack must be recreated to switch from REST to HTTP API.
2. **Destroy the existing stack** (REST API cannot be migrated in-place). Use your existing deploy command with `cdk destroy`/`npm run deploy -- destroy` equivalent for your profile/stage.
3. **Deploy v0.9.0** using your normal workflow, for example:
   - `npm run deploy:dev -- --profile <profile> --yes`
   - `npm run deploy:prod -- --profile <profile> --yes`
4. **Update Benchling webhook URL** in your Benchling app to the new HTTP API endpoint output by the stack.
5. **Validate**:
   - `npm run test:local` (Docker dev on port 8082)
   - `npm run test:local:prod` (Docker prod on port 8083)
   - `npm run test:native` (native Flask on port 8080)
6. **Monitor logs**:
   - API access logs: `/aws/apigateway/benchling-webhook-http`
   - Container logs: stack-named log group

## Local Development Notes

- Flask default port is now **8080** (set via `PORT` env var).
- Docker Compose maps to ports **8082** (dev) and **8083** (prod).
- Update any local curl scripts or tunnels that assumed port 5000.

## Rollback

If you need to roll back:

1. Re-deploy the previous 0.8.x stack from the corresponding tag.
2. Point Benchling back to the prior webhook URL.
3. Restore any port 5000 assumptions in local scripts if required.
