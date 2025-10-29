#!/usr/bin/env node

/**
 * Test script to verify @quiltdata/benchling-webhook can be imported from npm
 *
 * This simulates the typical usage pattern where the package is imported
 * as a dependency in a CDK app.
 */

import * as cdk from 'aws-cdk-lib';

console.log('✓ aws-cdk-lib imported successfully');

// Try to import the published package
try {
  const { BenchlingWebhookStack } = await import('@quiltdata/benchling-webhook');
  console.log('✓ @quiltdata/benchling-webhook imported successfully');
  console.log('✓ BenchlingWebhookStack:', typeof BenchlingWebhookStack);

  // Verify it's a valid CDK construct
  if (typeof BenchlingWebhookStack === 'function') {
    console.log('✓ BenchlingWebhookStack is a constructor function');

    // Create a minimal CDK app to test instantiation
    const app = new cdk.App();

    // Try to instantiate the stack (without real AWS resources)
    // This will validate the construct definition is correct
    try {
      new BenchlingWebhookStack(app, 'TestStack', {
        env: { account: '123456789012', region: 'us-east-1' },
        bucketName: 'test-bucket',
        queueName: 'test-queue',
        environment: 'test',
        prefix: 'test/prefix',
        benchlingClientId: 'test-client-id',
        benchlingClientSecret: 'test-client-secret',
        benchlingTenant: 'test-tenant',
        quiltCatalog: 'test.catalog.com',
        webhookAllowList: ['192.168.1.1/32'],
      });
      console.log('✓ BenchlingWebhookStack instantiated successfully');
      console.log('\n✅ All tests passed! Package is ready to use.');
    } catch (error) {
      console.error('✗ Failed to instantiate BenchlingWebhookStack:', error.message);
      process.exit(1);
    }
  } else {
    console.error('✗ BenchlingWebhookStack is not a constructor');
    process.exit(1);
  }
} catch (error) {
  console.error('✗ Failed to import @quiltdata/benchling-webhook:', error.message);
  console.error('\nMake sure to run: npm install @quiltdata/benchling-webhook');
  process.exit(1);
}
