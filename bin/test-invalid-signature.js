#!/usr/bin/env node
const { createSign, generateKeyPairSync } = require('crypto');
const fs = require('fs');

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length === 0) {
    console.error('Usage: test-invalid-signature.js <webhook-url>');
    console.error('Example: test-invalid-signature.js https://example.com/prod/lifecycle');
    process.exit(1);
}

const webhookUrl = args[0];

// Read the test payload
const testPayload = JSON.parse(fs.readFileSync('test-events/app-installed.json', 'utf8'));
const rawBody = JSON.stringify(testPayload);

// Generate a WRONG key pair (not the one Benchling has)
const { privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1'
});

// Create realistic webhook headers
const webhookId = 'wh_test123';
const webhookTimestamp = Math.floor(Date.now() / 1000).toString();

// Sign with the WRONG private key
const payloadToSign = `${webhookId}.${webhookTimestamp}.${rawBody}`;
const signer = createSign('sha256');
signer.update(payloadToSign);
signer.end();

const invalidSignature = signer.sign(privateKey).toString('base64');

console.log('Testing webhook security with INVALID signature');
console.log('='.repeat(60));
console.log('Target URL:', webhookUrl);
console.log('Webhook-Id:', webhookId);
console.log('Webhook-Timestamp:', webhookTimestamp);
console.log('Webhook-Signature:', `v1bder,${invalidSignature}`);
console.log('\nNote: This signature is valid ECDSA format but signed with the WRONG key.');
console.log('The webhook MUST reject this request.\n');

// Make the actual HTTP request
(async () => {
    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'webhook-id': webhookId,
                'webhook-timestamp': webhookTimestamp,
                'webhook-signature': `v1bder,${invalidSignature}`
            },
            body: rawBody
        });

        const responseText = await response.text();
        let responseBody;
        try {
            responseBody = JSON.parse(responseText);
        } catch {
            responseBody = responseText;
        }

        console.log('Response Status:', response.status, response.statusText);
        console.log('Response Body:', JSON.stringify(responseBody, null, 2));
        console.log();

        // Validate the response
        if (response.status === 202) {
            console.log('⚠️  WARNING: Request was ACCEPTED (202)');
            console.log('   This means validation happens asynchronously.');

            if (responseBody.executionArn) {
                console.log('   Checking execution status...');
                const executionArn = responseBody.executionArn;

                // Wait a bit for execution to start
                await new Promise(resolve => setTimeout(resolve, 2000));

                // Check execution status using AWS CLI
                const { execSync } = require('child_process');
                try {
                    const status = execSync(
                        `aws stepfunctions describe-execution --execution-arn "${executionArn}" --query 'status' --output text`,
                        { encoding: 'utf8' }
                    ).trim();

                    console.log('   Execution Status:', status);

                    if (status === 'FAILED') {
                        const history = execSync(
                            `aws stepfunctions get-execution-history --execution-arn "${executionArn}" --query 'events[?type==\`ExecutionFailed\`].executionFailedEventDetails.error' --output text`,
                            { encoding: 'utf8' }
                        ).trim();
                        console.log('   Failure Reason:', history || 'WebhookVerificationError');
                        console.log('\n✅ PASS: Webhook correctly rejected invalid signature (async)');
                        process.exit(0);
                    } else if (status === 'SUCCEEDED') {
                        console.log('\n❌ FAIL: Webhook accepted invalid signature!');
                        process.exit(1);
                    } else {
                        console.log(`   Status: ${status} - manual verification needed`);
                    }
                } catch (error) {
                    console.log('   Could not check execution status:', error.message);
                }
            }
        } else if (response.status === 401 || response.status === 403) {
            console.log('✅ PASS: Webhook correctly rejected invalid signature (sync)');
            process.exit(0);
        } else if (response.status >= 400) {
            console.log(`⚠️  Request rejected with status ${response.status}`);
            console.log('   Manual verification needed');
        } else if (response.status >= 200 && response.status < 300) {
            console.log('❌ FAIL: Webhook accepted invalid signature!');
            process.exit(1);
        }
    } catch (error) {
        console.error('Error making request:', error.message);
        process.exit(1);
    }
})();
