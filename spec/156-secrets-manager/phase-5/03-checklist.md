# Phase 5 Implementation Checklist: Registry Integration and Admin API

**Phase**: 5 of 8
**Feature**: Admin API for Secrets Configuration
**Date**: 2025-10-31
**Status**: Ready for Implementation

---

## Pre-Implementation

- [x] Design document reviewed and approved
- [x] Episodes defined with clear objectives
- [x] Dependencies identified
- [x] Testing strategy defined
- [x] Security considerations documented

---

## Episode 1: Lambda Function Foundation

### Setup
- [ ] Create directory `lib/lambda/`
- [ ] Create file `lib/lambda/admin-api-handler.ts`
- [ ] Install AWS SDK dependencies (if not already present)

### Implementation
- [ ] Create Lambda handler interface
- [ ] Implement request routing logic (switch on httpMethod + path)
- [ ] Add logging utility functions
- [ ] Implement error handling middleware
- [ ] Create response formatter (success and error)
- [ ] Implement `GET /admin/health` endpoint

### Testing
- [ ] Write unit test for request routing
- [ ] Write unit test for error handling
- [ ] Write unit test for response formatting
- [ ] Write unit test for health endpoint
- [ ] Run tests and verify passing
- [ ] Check test coverage >90%

### Quality
- [ ] Run `npm run lint` and fix issues
- [ ] Run `npm run typecheck` and fix issues
- [ ] Git commit with message: `feat(admin-api): create Lambda handler foundation`

---

## Episode 2: Secret Metadata Retrieval

### Implementation
- [ ] Import `SecretsManagerClient` from AWS SDK v3
- [ ] Create `getSecretMetadata()` function
- [ ] Implement `DescribeSecretCommand` call
- [ ] Parse secret ARN components (region, account, name)
- [ ] Extract last modified timestamp
- [ ] Extract tags and description
- [ ] Handle `ResourceNotFoundException`
- [ ] Handle other AWS errors gracefully

### Testing
- [ ] Write unit test with mocked `DescribeSecretCommand`
- [ ] Test successful metadata retrieval
- [ ] Test secret not found scenario
- [ ] Test malformed ARN handling
- [ ] Test AWS service errors
- [ ] Run tests and verify passing

### Quality
- [ ] Verify no secret values returned
- [ ] Check error messages are helpful
- [ ] Run lint and typecheck
- [ ] Git commit: `feat(admin-api): implement secret metadata retrieval`

---

## Episode 3: Secret Validation Logic

### Implementation
- [ ] Import validation functions from `lib/utils/secrets.ts`
- [ ] Create `validateSecretStructure()` function
- [ ] Implement `GetSecretValueCommand` call (for validation only)
- [ ] Parse secret JSON value
- [ ] Call `validateSecretData()` from Phase 1
- [ ] Extract field names (not values) for response
- [ ] Format validation errors without sensitive data
- [ ] Handle secret decryption errors

### Testing
- [ ] Write unit test with valid secret
- [ ] Write unit test with invalid secret (missing fields)
- [ ] Write unit test with malformed JSON
- [ ] Verify response contains field names, not values
- [ ] Test validation errors formatted correctly
- [ ] Run tests and verify passing

### Quality
- [ ] Security review: ensure no secret values in logs
- [ ] Security review: ensure no secret values in responses
- [ ] Run lint and typecheck
- [ ] Git commit: `feat(admin-api): implement secret validation logic`

---

## Episode 4: API Endpoints Implementation

### Implementation
- [ ] Implement `GET /admin/secrets` handler
  - [ ] List all secrets with pattern `benchling-webhook/*`
  - [ ] Return array of secret metadata
  - [ ] Handle empty list
- [ ] Implement `GET /admin/secrets/{secretName}` handler
  - [ ] Extract secretName from path
  - [ ] URL-decode secret name
  - [ ] Get detailed metadata
  - [ ] Return 404 if not found
- [ ] Implement `POST /admin/secrets/validate` handler
  - [ ] Parse request body
  - [ ] Validate either secretArn or secretData
  - [ ] Return validation result
  - [ ] Handle validation errors
- [ ] Add request validation middleware
- [ ] Add response sanitization (double-check no secrets)

### Testing
- [ ] Write unit test for `GET /admin/secrets`
- [ ] Write unit test for `GET /admin/secrets/{secretName}`
- [ ] Write unit test for `POST /admin/secrets/validate`
- [ ] Test with invalid requests (malformed, missing params)
- [ ] Test error scenarios (404, 500)
- [ ] Verify response sanitization
- [ ] Run tests and verify passing

### Quality
- [ ] Code review for security
- [ ] Check all responses follow API design
- [ ] Run lint and typecheck
- [ ] Git commit: `feat(admin-api): implement all API endpoints`

---

## Episode 5: CDK Admin API Gateway Construct

### Implementation
- [ ] Create file `lib/admin-api-gateway.ts`
- [ ] Define `AdminApiGatewayProps` interface
  - [ ] `secret: secretsmanager.ISecret`
  - [ ] `allowedPrincipals?: string[]`
- [ ] Create `AdminApiGateway` construct class
- [ ] Create Lambda function from handler code
  - [ ] Runtime: Node.js 18.x
  - [ ] Memory: 512 MB
  - [ ] Timeout: 30 seconds
  - [ ] Environment: `SECRET_NAME`, `AWS_REGION`
- [ ] Create API Gateway REST API
  - [ ] Name: "benchling-webhook-admin-api"
  - [ ] Description: "Admin API for Benchling webhook secret management"
- [ ] Configure IAM authorizer
  - [ ] Type: AWS_IAM
  - [ ] Authorization type: AWS_IAM
- [ ] Add Lambda integration
  - [ ] Proxy integration: false
  - [ ] Request templates if needed
- [ ] Create API resources and methods
  - [ ] `/admin/health` - GET
  - [ ] `/admin/secrets` - GET
  - [ ] `/admin/secrets/{secretName}` - GET
  - [ ] `/admin/secrets/validate` - POST
- [ ] Configure resource policy
  - [ ] Allow principals from `allowedPrincipals`
  - [ ] Deny all others
- [ ] Create CloudWatch Log Group for API
  - [ ] Retention: 7 days
  - [ ] Name: `/aws/apigateway/benchling-webhook-admin`
- [ ] Enable access logging
- [ ] Add CORS configuration (if needed)
- [ ] Export API endpoint URL

### Testing
- [ ] CDK synth test verifies template structure
- [ ] Check Lambda function created
- [ ] Check API Gateway created with IAM auth
- [ ] Check resource policy applied
- [ ] Check logging enabled
- [ ] Run `npm run build` successfully

### Quality
- [ ] Follow CDK best practices
- [ ] Use L2 constructs where available
- [ ] Run lint and typecheck
- [ ] Git commit: `feat(admin-api): create CDK construct for API Gateway`

---

## Episode 6: IAM Roles and Permissions

### Implementation
- [ ] Create Lambda execution role
  - [ ] Trust policy: `lambda.amazonaws.com`
  - [ ] Managed policy: `AWSLambdaBasicExecutionRole`
- [ ] Grant Secrets Manager permissions to Lambda role
  - [ ] Action: `secretsmanager:DescribeSecret`
  - [ ] Action: `secretsmanager:GetSecretValue`
  - [ ] Action: `secretsmanager:ListSecrets`
  - [ ] Resource: `arn:aws:secretsmanager:*:*:secret:benchling-webhook/*`
- [ ] Grant CloudWatch Logs permissions (via managed policy)
- [ ] Create API Gateway resource policy
  - [ ] Allow invoke from specified IAM principals
  - [ ] Deny all other principals
- [ ] Document user IAM policy template in `docs/ADMIN_API.md`
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "execute-api:Invoke"
        ],
        "Resource": [
          "arn:aws:execute-api:region:account:api-id/*/GET/admin/*",
          "arn:aws:execute-api:region:account:api-id/*/POST/admin/secrets/validate"
        ]
      }
    ]
  }
  ```

### Testing
- [ ] Test Lambda can access Secrets Manager (integration test)
- [ ] Test Lambda can write to CloudWatch Logs
- [ ] Test unauthorized IAM principal blocked (403)
- [ ] Test authorized IAM principal succeeds (200)
- [ ] Verify least privilege (Lambda can't write to Secrets Manager)

### Quality
- [ ] Security review of IAM policies
- [ ] Verify least privilege principle
- [ ] Run lint and typecheck
- [ ] Git commit: `feat(admin-api): configure IAM roles and permissions`

---

## Episode 7: Stack Integration

### Implementation
- [ ] Add props to `BenchlingWebhookStackProps`
  - [ ] `enableAdminApi?: boolean` (default: false)
  - [ ] `adminApiAllowedPrincipals?: string[]`
- [ ] Add CloudFormation parameter
  - [ ] Name: `EnableAdminApi`
  - [ ] Type: `String`
  - [ ] AllowedValues: `["true", "false"]`
  - [ ] Default: `"false"`
  - [ ] Description: "Enable admin API for secret management"
- [ ] Add conditional Admin API creation
  ```typescript
  if (props.enableAdminApi) {
    this.adminApi = new AdminApiGateway(this, "AdminApi", {
      secret: this.fargateService.benchlingSecret,
      allowedPrincipals: props.adminApiAllowedPrincipals || [],
    });
  }
  ```
- [ ] Add stack output for Admin API URL
  ```typescript
  if (this.adminApi) {
    new cdk.CfnOutput(this, "AdminApiEndpoint", {
      value: this.adminApi.api.url,
      description: "Admin API endpoint URL",
      exportName: "BenchlingWebhookAdminApiUrl",
    });
  }
  ```
- [ ] Update CLI to support `--enable-admin-api` flag
- [ ] Update deployment command to pass flag to stack

### Testing
- [ ] CDK synth with admin API disabled (default)
  - [ ] Verify no Admin API in template
- [ ] CDK synth with admin API enabled
  - [ ] Verify Admin API in template
  - [ ] Verify stack outputs include admin API URL
- [ ] Integration test: deploy with admin API enabled
- [ ] Integration test: verify admin API accessible
- [ ] Backward compatibility test: existing deployments work

### Quality
- [ ] Verify backward compatibility (disabled by default)
- [ ] Check stack outputs
- [ ] Run lint and typecheck
- [ ] Git commit: `feat(admin-api): integrate into main CDK stack`

---

## Episode 8: Documentation and Examples

### Implementation
- [ ] Create `docs/ADMIN_API.md`
  - [ ] Overview section
  - [ ] Authentication and authorization
  - [ ] API endpoint reference
  - [ ] AWS SigV4 signing explanation
  - [ ] Example requests and responses
- [ ] Document IAM policy requirements
  - [ ] User policy template
  - [ ] Lambda execution role policy
- [ ] Create AWS CLI examples
  - [ ] GET /admin/secrets
  - [ ] GET /admin/secrets/{secretName}
  - [ ] POST /admin/secrets/validate
  - [ ] Include SigV4 signing commands
- [ ] Create SDK examples (TypeScript)
  ```typescript
  import { ApiGatewayClient } from '@aws-sdk/client-api-gateway';

  const client = new ApiGatewayClient({ region: 'us-east-1' });
  const response = await client.send(new InvokeCommand({
    restApiId: 'abc123',
    resourcePath: '/admin/secrets',
    httpMethod: 'GET',
  }));
  ```
- [ ] Create SDK examples (Python)
  ```python
  import boto3
  from botocore.auth import SigV4Auth
  from botocore.awsrequest import AWSRequest

  # Example code here
  ```
- [ ] Add troubleshooting section
  - [ ] 403 Forbidden errors
  - [ ] IAM permission issues
  - [ ] Secret not found errors
- [ ] Update main `README.md`
  - [ ] Add "Admin API" section
  - [ ] Link to detailed documentation
  - [ ] Mention `--enable-admin-api` flag
- [ ] Update `CHANGELOG.md`
  - [ ] Document Admin API feature
  - [ ] Note it's disabled by default
  - [ ] Breaking changes: None

### Testing
- [ ] Verify all AWS CLI examples work
- [ ] Test IAM policy examples grant correct access
- [ ] Test TypeScript SDK example
- [ ] Test Python SDK example
- [ ] Check all documentation links valid
- [ ] Spell check and grammar review

### Quality
- [ ] Documentation review by team member
- [ ] User testing with fresh reader
- [ ] Check examples are copy-paste ready
- [ ] Git commit: `docs(admin-api): add comprehensive documentation`

---

## Post-Implementation

### Integration Testing
- [ ] Deploy full stack to test environment
- [ ] Enable admin API
- [ ] Configure IAM user with access
- [ ] Test all endpoints end-to-end
  - [ ] GET /admin/health (no auth)
  - [ ] GET /admin/secrets (with auth)
  - [ ] GET /admin/secrets/benchling-webhook-credentials (with auth)
  - [ ] POST /admin/secrets/validate (with auth)
- [ ] Verify CloudWatch logs
- [ ] Verify CloudTrail audit trail
- [ ] Test unauthorized access blocked
- [ ] Test with wrong IAM permissions blocked

### Security Review
- [ ] No secret values in API responses ✓
- [ ] IAM authorization working ✓
- [ ] Resource policy restricting access ✓
- [ ] CloudWatch logging enabled ✓
- [ ] CloudTrail capturing API calls ✓
- [ ] Least privilege IAM policies ✓
- [ ] No hardcoded credentials ✓

### Performance Testing
- [ ] Measure API response time (target: <500ms)
- [ ] Test concurrent requests (target: handle 10 RPS)
- [ ] Check Lambda cold start time
- [ ] Verify CloudWatch metrics

### Documentation Review
- [ ] All endpoints documented ✓
- [ ] Examples working ✓
- [ ] IAM policies tested ✓
- [ ] Troubleshooting guide helpful ✓
- [ ] README updated ✓

### Code Quality
- [ ] All tests passing (unit + integration)
- [ ] Test coverage >85%
- [ ] Lint errors: 0
- [ ] TypeScript errors: 0
- [ ] Security vulnerabilities: 0 (npm audit)

---

## Deployment Checklist

### Pre-Deployment
- [ ] All episodes complete
- [ ] All tests passing
- [ ] Documentation complete
- [ ] Code review approved
- [ ] Security review approved

### Deployment Steps
- [ ] Merge feature branch to main
- [ ] Tag release (e.g., v0.6.0)
- [ ] Deploy to staging environment
- [ ] Run smoke tests in staging
- [ ] Deploy to production environment
- [ ] Verify production deployment
- [ ] Update release notes

### Post-Deployment
- [ ] Monitor CloudWatch metrics
- [ ] Monitor error rates
- [ ] Check user feedback
- [ ] Document any issues
- [ ] Plan follow-up improvements

---

## Success Criteria

- [x] Design document complete
- [x] Episodes document complete
- [x] Implementation checklist complete
- [ ] All 8 episodes implemented
- [ ] All tests passing
- [ ] Admin API functional and secure
- [ ] IAM authorization working
- [ ] Documentation comprehensive
- [ ] Zero security vulnerabilities
- [ ] Integration tests pass 100%
- [ ] Ready for production deployment

---

## Rollback Plan

If issues arise in production:

1. **Immediate Actions**
   - Disable admin API via CloudFormation parameter update
   - Set `EnableAdminApi=false`
   - Stack update takes ~5 minutes
   - Admin API removed, webhook continues working

2. **Investigation**
   - Check CloudWatch logs
   - Review CloudTrail for suspicious activity
   - Analyze error patterns
   - Identify root cause

3. **Fix and Redeploy**
   - Fix issues in code
   - Test in staging
   - Redeploy to production
   - Re-enable admin API

---

**Phase 5 Status**: Ready for Implementation
**Estimated Time**: 6-8 hours of focused development
**Next Step**: Begin Episode 1 - Lambda Function Foundation
