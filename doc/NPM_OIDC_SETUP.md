# NPM OIDC Configuration for GitHub Actions

This repository now uses OpenID Connect (OIDC) for publishing to npm, eliminating the need for long-lived `NPM_TOKEN` secrets.

## What Changed

The GitHub Actions workflow ([.github/workflows/ci.yaml](.github/workflows/ci.yaml)) has been updated to:

1. Add `id-token: write` permission for OIDC token generation
2. Use `npm publish --provenance --access public` with automatic OIDC authentication
3. Remove dependency on `NPM_TOKEN` GitHub secret

## Required npm Configuration

To enable OIDC publishing, you need to configure your npm package settings:

### 1. Enable Provenance on npm

The `--provenance` flag automatically uses OIDC when available. npm will:

- Accept OIDC tokens from GitHub Actions
- Generate signed provenance attestations
- Link published packages to their source code and build process

### 2. Configure npm Package Access

If not already configured, ensure your npm account has:

1. **Publishing access** to the `quilt-benchling-webhook` package
2. **Provenance enabled** for your npm account/organization

### 3. Update npm Settings (If First Time Using OIDC)

Visit [npm automation tokens settings](https://www.npmjs.com/settings/~/tokens) and:

1. You can safely **delete the old `NPM_TOKEN`** secret from GitHub after verifying OIDC works
2. No new token needs to be created - OIDC handles authentication automatically
3. Ensure your npm organization settings allow publishing with provenance

### 4. Grant GitHub Actions Access (npm Configuration)

For npm to accept OIDC tokens from your repository:

1. Go to [npm package settings](https://www.npmjs.com/package/quilt-benchling-webhook/access)
2. Ensure the package allows automated publishing
3. npm automatically trusts GitHub Actions OIDC tokens for configured organizations

## Testing the Setup

To test OIDC publishing:

1. Create a test tag: `git tag v0.4.14-dev.1 && git push origin v0.4.14-dev.1`
2. Monitor the GitHub Actions workflow
3. The "Publish to NPM" step should succeed without `NODE_AUTH_TOKEN`
4. Verify provenance on npm: `npm view quilt-benchling-webhook`

## Troubleshooting

### "Unable to authenticate" errors

- Verify `id-token: write` permission is set in the workflow
- Check that `registry-url: 'https://registry.npmjs.org'` is configured in the Node.js setup
- Ensure the package exists and your account has publishing rights

### "Provenance not supported" errors

- Update to npm 9.5.0 or later (the workflow uses Node.js 24 which includes npm 10.x)
- Verify your npm account/organization supports provenance

### Need to roll back?

If you need to revert to token-based authentication:

1. Create a new npm automation token
2. Add it as `NPM_TOKEN` secret in GitHub
3. Remove `--provenance` flag and add back:

   ```yaml
   env:
     NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
   ```

## Benefits of OIDC

- **No secret rotation**: No long-lived tokens to manage or rotate
- **Better security**: Tokens are short-lived and scoped to specific workflows
- **Provenance**: Published packages include verifiable build provenance
- **Audit trail**: Clear link between published packages and their source
- **Supply chain security**: Helps prevent package tampering and improves trust

## References

- [npm Provenance Documentation](https://docs.npmjs.com/generating-provenance-statements)
- [GitHub Actions OIDC](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- [npm publish with provenance](https://docs.npmjs.com/cli/v10/commands/npm-publish#provenance)
