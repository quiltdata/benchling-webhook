# benchling-webhook

API Gateway for processing Benchling Events

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

## Usage

```bash
export ENDPOINT_ID=4sdc7ph31f
export ENDPOINT_URL=https://$ENDPOINT_ID.execute-api.$CDK_DEFAULT_REGION.amazonaws.com/$STAGE/benchling-webhook

curl -X POST $ENDPOINT_URL \
     -H "Content-Type: application/json" \
     -d '{
           "message": "Hello from Benchling webhook!",
           "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
         }'
aws s3 cp s3://$BUCKET_NAME/$PREFIX/api_payload.json -
open https://$QUILT_CATALOG/b/$BUCKET_NAME/tree/$PREFIX/
```

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
