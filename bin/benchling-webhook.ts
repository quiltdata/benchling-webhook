#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { BenchlingWebhookStack } from "../lib/benchling-webhook-stack";

const app = new cdk.App();
new BenchlingWebhookStack(app, "BenchlingWebhookStack", {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
    },
    bucketName: process.env.BUCKET_NAME || "my-bucket-name",
    queueName: process.env.QUEUE_NAME || "my-queue-name",
    environment: process.env.STAGE || "prod",
    prefix: process.env.PREFIX || "benchling",
    benchlingClientId: process.env.BENCHLING_CLIENT_ID || "",
    benchlingClientSecret: process.env.BENCHLING_CLIENT_SECRET || "",
    benchlingTenant: process.env.BENCHLING_TENANT || "",
    quiltCatalog: process.env.QUILT_CATALOG || "open.quiltdata.com",
    webhookAllowList: process.env.WEBHOOK_ALLOW_LIST,
});
