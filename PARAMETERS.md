# CloudFormation Parameters

This stack supports runtime-configurable parameters that can be updated without redeploying the entire stack.

## Available Parameters

### WebhookAllowList
- **Type**: String (comma-separated IP addresses)
- **Description**: List of IP addresses allowed to send webhooks
- **Default**: Value from `WEBHOOK_ALLOW_LIST` environment variable (or empty to allow all IPs)
- **Example**: `34.216.192.90,34.217.183.162`

### QuiltCatalog
- **Type**: String
- **Description**: Quilt catalog URL for package links
- **Default**: `open.quiltdata.com`
- **Example**: `catalog.example.com`

## Updating Parameters

### Using AWS CLI

Update parameters without redeploying the stack:

```bash
# Update webhook allow list
aws cloudformation update-stack \
  --stack-name BenchlingWebhookStack \
  --use-previous-template \
  --parameters \
    ParameterKey=WebhookAllowList,ParameterValue="1.2.3.4,5.6.7.8" \
    ParameterKey=QuiltCatalog,UsePreviousValue=true

# Update both parameters
aws cloudformation update-stack \
  --stack-name BenchlingWebhookStack \
  --use-previous-template \
  --parameters \
    ParameterKey=WebhookAllowList,ParameterValue="34.216.192.90,34.217.183.162" \
    ParameterKey=QuiltCatalog,ParameterValue="my-catalog.quiltdata.com"
```

### Using AWS Console

1. Go to CloudFormation in AWS Console
2. Select the `BenchlingWebhookStack` stack
3. Click **Update**
4. Select **Use current template**
5. Click **Next**
6. Update the parameter values:
   - **WebhookAllowList**: Enter comma-separated IP addresses
   - **QuiltCatalog**: Enter catalog URL
7. Click **Next** through the remaining screens
8. Click **Update stack**

### Using CDK

Parameters are automatically created during CDK deployment. The initial values come from environment variables, but subsequent updates can be done via CloudFormation (as shown above) without redeploying via CDK.

## Benefits

- **No Code Deployment**: Update security settings (IP allowlist) without redeploying code
- **Fast Updates**: CloudFormation parameter updates are much faster than full stack updates
- **Zero Downtime**: Parameter updates don't require Lambda redeployment
- **Audit Trail**: All parameter changes are tracked in CloudFormation change sets

## Implementation Details

### Architecture

1. **CloudFormation Parameters**: Defined at stack level
2. **Lambda Environment Variables**: Automatically updated from parameters
3. **API Gateway Resource Policy**: Automatically updated from parameters

### How It Works

The stack uses a hybrid approach:
- **Initial Deployment**: Uses environment variable values from `bin/benchling-webhook.ts`
- **Subsequent Updates**: Uses CloudFormation parameter values
- **Lambda Environment**: Automatically reflects parameter changes via CloudFormation

When you update a parameter via CloudFormation:
1. CloudFormation updates the Lambda function's environment variables
2. CloudFormation updates the API Gateway Resource Policy
3. Lambda automatically picks up the new values on next invocation (no cold start required)
4. API Gateway immediately enforces the new IP allowlist

## Examples

### Add a new IP to the allowlist

```bash
# Current IPs: 34.216.192.90,34.217.183.162
# Adding new IP: 203.0.113.10

aws cloudformation update-stack \
  --stack-name BenchlingWebhookStack \
  --use-previous-template \
  --parameters \
    ParameterKey=WebhookAllowList,ParameterValue="34.216.192.90,34.217.183.162,203.0.113.10" \
    ParameterKey=QuiltCatalog,UsePreviousValue=true
```

### Switch to a different Quilt catalog

```bash
aws cloudformation update-stack \
  --stack-name BenchlingWebhookStack \
  --use-previous-template \
  --parameters \
    ParameterKey=WebhookAllowList,UsePreviousValue=true \
    ParameterKey=QuiltCatalog,ParameterValue="prod-catalog.quiltdata.com"
```

### Allow all IPs (remove IP filtering)

```bash
aws cloudformation update-stack \
  --stack-name BenchlingWebhookStack \
  --use-previous-template \
  --parameters \
    ParameterKey=WebhookAllowList,ParameterValue="" \
    ParameterKey=QuiltCatalog,UsePreviousValue=true
```

## Troubleshooting

### Parameter update fails

If the CloudFormation update fails, check:
- IP addresses are valid (no spaces, proper CIDR notation if needed)
- Catalog URL is a valid hostname
- You're using `--use-previous-template` flag

### Changes not taking effect

- API Gateway Resource Policy updates are immediate
- Lambda environment variable updates require the Lambda to be invoked again
- Check CloudFormation Events tab for update status
