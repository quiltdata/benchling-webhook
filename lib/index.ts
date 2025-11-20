/**
 * Benchling Webhook Integration for Quilt
 *
 * This module exports CDK constructs for deploying a Benchling webhook integration
 * that creates Quilt packages from Benchling lab notebook entries.
 *
 * @example Basic usage
 * ```typescript
 * import * as cdk from 'aws-cdk-lib';
 * import { BenchlingWebhookStack } from 'quilt-benchling-webhook';
 *
 * const app = new cdk.App();
 * new BenchlingWebhookStack(app, 'MyBenchlingWebhook', {
 *   env: { account: '123456789012', region: 'us-east-1' },
 *   bucketName: 'my-data-bucket',
 *   queueName: 'my-packager-queue',
 *   benchlingClientId: process.env.BENCHLING_CLIENT_ID!,
 *   benchlingClientSecret: process.env.BENCHLING_CLIENT_SECRET!,
 *   benchlingTenant: 'my-org',
 *   quiltCatalog: 'my-catalog.quiltdata.com',
 *   quiltDatabase: 'my_athena_db',
 * });
 * ```
 *
 * @module quilt-benchling-webhook
 */

export { BenchlingWebhookStack, type BenchlingWebhookStackProps } from "./benchling-webhook-stack";
export { FargateService } from "./fargate-service";
export { PrivateNLB } from "./private-nlb";
export { VPCLinkGateway } from "./vpc-link-gateway";
export { AlbApiGateway } from "./alb-api-gateway"; // DEPRECATED: Will be removed in v0.10.0
export { EcrRepository } from "./ecr-repository";
