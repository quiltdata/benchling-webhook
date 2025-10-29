# NPM Package Import Test

This directory contains a test script to verify that `@quiltdata/benchling-webhook` can be successfully imported from npm.

## Package Status

The package `@quiltdata/benchling-webhook@0.4.13` is now published and available!

Check the latest status:
```bash
# From the main directory
npm run publish -- --check

# Or directly
npm view @quiltdata/benchling-webhook
```

## Usage

```bash
cd .scratch
npm install
npm test
```

## What it tests

1. Imports `aws-cdk-lib` (peer dependency)
2. Imports `@quiltdata/benchling-webhook` from npm registry
3. Verifies `BenchlingWebhookStack` export exists
4. Instantiates the stack with test parameters to validate the construct

## Expected Output

```
✓ aws-cdk-lib imported successfully
✓ @quiltdata/benchling-webhook imported successfully
✓ BenchlingWebhookStack: function
✓ BenchlingWebhookStack is a constructor function
✓ BenchlingWebhookStack instantiated successfully

✅ All tests passed! Package is ready to use.
```
