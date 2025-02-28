# benchling-webhook

API Gateway for processing Benchling Events

The `cdk.json` file tells the CDK Toolkit how to execute your app.

```bash
curl -X POST https://gtju7dq18a.execute-api.us-west-1.amazonaws.com/prod/benchling-webhook \
     -H "Content-Type: application/json" \
     -d '{
           "message": "Hello from Benchling webhook!",
           "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
         }'
aws s3 cp s3://quilt-ernest-staging/test/benchling-webhook/api_payload.json -
open https://nightly.quilttest.com/b/quilt-ernest-staging/tree/test/benchling-webhook/api_payload.json
```

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
