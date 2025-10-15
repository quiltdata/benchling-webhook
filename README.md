# benchling-webhook

API Gateway for processing Benchling Events

## Project Structure

The codebase is organized as follows:

- `lib/constants.ts` - Shared constants and configuration
- `lib/types.ts` - TypeScript interfaces and types
- `lib/state-machine.ts` - AWS Step Functions workflow definition
- `lib/lambda/process-export.ts` - Lambda function for processing exports

## Architecture

This project implements a serverless webhook processor for Benchling events using AWS services:

- API Gateway receives webhook events
- Step Functions orchestrates the processing
- S3 stores event data and entry details
- SQS handles notifications

See [lib/README.md](lib/README.md) for detailed architecture documentation.

## Configuration

Create a `.env` file with the following content:

```bash
export CDK_DEFAULT_ACCOUNT=XXXXXXXXXXXX
export CDK_DEFAULT_REGION=us-west-2
export BUCKET_NAME=bucket-in-that-region
export PREFIX=benchling
export QUILT_CATALOG=stable.quilttest.com
export QUEUE_NAME=tf-stable-PackagerQueue-4g1PXC9992vI
export QUEUE_URL=https://sqs.$CDK_DEFAULT_REGION.amazonaws.com/$CDK_DEFAULT_ACCOUNT/$QUEUE_NAME
export BENCHLING_TENANT=<YOUR_BENCHLING_TENANT>
export BENCHLING_CLIENT_ID=<YOUR_BENCHLING_APP_CLIENT_ID>
export BENCHLING_CLIENT_SECRET=<YOUR_BENCHLING_CLIENT_SECRET>
export WEBHOOK_ALLOW_LIST="203.0.113.10,198.51.100.5" # optional: comma-separated source IPs
```

### Configuration Notes

**IMPORTANT - S3 Bucket Region:** The `BUCKET_NAME` must be an S3 bucket located in the **same region** as `CDK_DEFAULT_REGION`. If you specify a bucket in a different region, the packaging state machine will fail with a `PermanentRedirect` error. The bucket must also be connected to your Quilt stack.

- **QUEUE_NAME**: Choose the name of the "PackagerQueue" in your Quilt stack. This will allow the BenchlingWebhookStack to send messages to the Quilt Packaging Engine
- **BENCHLING_TENANT**: Use XXX if you login to benchling at XXX.benchling.com
- **WEBHOOK_ALLOW_LIST**: Set to the public IPs Benchling uses for webhook delivery to add an IP-based guardrail around signature verification. Leave unset to accept Benchling traffic from any source.

## Deployment

```bash
source .env
npx cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION
npx cdk deploy
```

## Benchling Setup

1. Create an [App Manifest](./app-manifest.yaml) that subscribes to the desired events
2. In Benchling, go to lower left Profile -> Feature Settings -> Developer Console
3. Apps -> Create app -> From manifest
   1. Select Public
   2. Add app manifest
   3. Create
4. Create Client Secret
5. Copy `BENCHLING_CLIENT_ID` and `BENCHLING_CLIENT_SECRET` to `.env`
6. Go to Overview -> Webhook URL
   1. Click edit
   2. Paste in the API Gateway URL from cdk
   3. Save
7. Go to Version History -> Install
8. Click "View app in workspace"
9. Click "Activate"
10. Go to Profile -> Tenant Admin console
    1. Verify it is in Apps
    2. Go to Organizations -> "your org"
11. Go to "Apps" tab
    1. Start typing 'benchling-webhook' in the search box
    2. Click "Add app"
    3. Select the app
    4. Change the 'Role' to 'Admin'

## Usage

1. Create a new entry in the Benchling app
    1. Go to the "Benchling" tab
    2. Click "Create > Entry -> Blank entry"
    3. Set a name
    4. Click "Create"
2. Add the Canvas app to the entry
    1. Select "Insert -> Canvas" from the Toolbar
    2. Select "Quilt Integration"
    3. Click "Insert"
3. In the Canvas section
    1. Click "Create" (wait a few seconds for it to create)
    2. Wait a bit for the package to be asynchronously created
    3. Command-Click "Quilt Catalog" to open the package in a new window
4. Drag in an attachment to the Benchling entry
    1. Click "Update package" to create a new version

## Testing

```bash
export ENDPOINT_ID=4abcdef123
export ENDPOINT_URL=https://$ENDPOINT_ID.execute-api.$CDK_DEFAULT_REGION.amazonaws.com/$STAGE/event
export ENTRY_ID=etr_XXXXXX

curl -X POST $ENDPOINT_URL -H "Content-Type: application/json" -d @test/entry-updated.json

aws s3 cp s3://$BUCKET_NAME/$PREFIX/$ENTRY_ID/api_payload.json -
open https://$QUILT_CATALOG/b/$BUCKET_NAME/tree/$PREFIX/$ENTRY_ID
```

## Useful commands

- `npm run build`   compile typescript to js
- `npm run watch`   watch for changes and compile
- `npm run test`    perform the jest unit tests
- `npx cdk deploy`  deploy this stack to your default AWS account/region
- `npx cdk diff`    compare deployed stack with current state
- `npx cdk synth`   emits the synthesized CloudFormation template
