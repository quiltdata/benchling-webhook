# Secrets Fix Status

## Current Snapshot
- Prevented `sync-secrets` from writing the secret name/ARN by resolving the actual `client_secret` before every update.
- Taught the Python resolver to accept both `clientSecret` and `client_secret`, keeping runtime JSON compatible with the new writer.
- Hardened `XDGConfig` atomic writes by staging temp files inside each profile directory, eliminating cross-device rename failures when the suite runs in parallel.
- Added regression coverage in Jest (`test/sync-secrets.test.ts`) to assert the sync path preserves the resolved credential value and in pytest (`test_secrets_resolver.py`) for snake_case parsing.
- Audited remaining CLI writers (`setup-wizard`, `init`) and confirmed they source secrets through the same resolved value flow before persisting.

## Tests Ran
- `npm run test:ts -- --runTestsByPath test/sync-secrets.test.ts`
- `cd docker && uv run pytest tests/test_secrets_resolver.py -k snake_case`
- `npm run test`

## Follow Ups
- None
