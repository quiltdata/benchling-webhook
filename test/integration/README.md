# Integration Tests

Integration tests make LIVE AWS API calls and require:

1. AWS credentials configured (via `~/.aws/credentials` or environment variables)
2. A deployed Quilt CloudFormation stack to test against
3. Configuration profile with stackArn

## Running Integration Tests

```bash
# Run all integration tests
npm run test:integration

# Run specific test file
npm run test:integration -- stack-resource-discovery.test.ts

# Run with verbose output
npm run test:integration -- --verbose
```

## Test Configuration

Integration tests use configuration from:
- **Profile**: `~/.config/benchling-webhook/default/config.json` (XDG default)
- **Stack ARN**: Read from profile's `quilt.stackArn`
- **AWS Credentials**: Standard AWS SDK credential resolution

## Safety

Integration tests:
- Only make READ operations (DescribeStacks, DescribeStackResources)
- Do NOT create, update, or delete any AWS resources
- Can be safely run against production stacks

## Example Configuration

`~/.config/benchling-webhook/default/config.json`:
```json
{
  "quilt": {
    "stackArn": "arn:aws:cloudformation:us-east-2:123456789012:stack/tf-dev-bench/...",
    "catalog": "dev.quiltdata.com",
    "region": "us-east-2"
  }
}
```

## Troubleshooting

If tests fail with "No stackArn found in default profile":
1. Run: `npm run setup`
2. Ensure AWS credentials are configured
3. Verify Quilt stack is deployed
