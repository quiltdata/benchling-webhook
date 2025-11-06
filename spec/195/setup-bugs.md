# SETUP BUGS - RESOLVED

## Fixed Issues

1. ✅ Schema validation removed from configuration saver
   - The UX is the source of truth, not schema validation
   - Removed `validateConfig()` method and `skipValidation` option

2. ✅ Docker image tag prompt removed
   - No longer prompted in wizard
   - Set during deployment via `--image-tag` CLI option or CFN parameter
   - Defaults to "latest" if not specified

3. ✅ Webhook signature verification prompt removed
   - Hardcoded to `true` in wizard
   - Can be overridden by environment variable at runtime
