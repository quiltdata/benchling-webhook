#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BenchlingWebhookStack } from '../lib/benchling-webhook-stack';

const app = new cdk.App();
new BenchlingWebhookStack(app, 'BenchlingWebhookStack', {
    bucketName: process.env.BUCKET_NAME || 'quilt-ernest-staging',
    environment: process.env.ENVIRONMENT || 'prod'
});
