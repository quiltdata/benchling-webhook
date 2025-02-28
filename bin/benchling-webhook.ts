#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BenchlingWebhookStack } from '../lib/benchling-webhook-stack';

const app = new cdk.App();
new BenchlingWebhookStack(app, 'BenchlingWebhookStack', {
    bucketName: 'quilt-ernest-staging',
    environment: 'prod',
    prefix: 'test/benchling-webhook',
    queueName: 'tf-stable-PackagerQueue-4g1PXC9992vI'
});
