#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BenchlingWebhookStack } from '../lib/benchling-webhook-stack';

const app = new cdk.App();
new BenchlingWebhookStack(app, 'BenchlingWebhookStack', {
    bucketName: 'quilt-ernest-staging',
    environment: 'prod',
    prefix: 'test/benchling-webhook',
    queueName: 'quilt-staging-PackagerQueue-d5NmglefXjDn',
    queueRegion: 'us-east-1'
});
