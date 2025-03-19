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
export PREFIX=test/benchling-webhook
export QUEUE_NAME=STACK_NAME-PackagerQueue-XXXXXXX
export QUEUE_URL=https://sqs.$CDK_DEFAULT_REGION.amazonaws.com/$CDK_DEFAULT_ACCOUNT/$QUEUE_NAME
```

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
    1. Start typing 'package-with-quilt' in the search box
    2. Click "Add app"
    3. Select the app
    4. Change the 'Role' to 'Admin'

## Usage

```bash
export ENDPOINT_ID=4abcdef123
export ENDPOINT_URL=https://$ENDPOINT_ID.execute-api.$CDK_DEFAULT_REGION.amazonaws.com/$STAGE/event
export ENTRY_ID=etr_XXXXXX

curl -X POST $ENDPOINT_URL -H "Content-Type: application/json" -d @test/entry-created.json

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
