# Phase 5 Design: Registry Integration and Admin API

**Phase**: 5 of 8
**Feature**: Admin API for Secrets Configuration
**Date**: 2025-10-31
**Status**: Design Complete

---

## Overview

This phase adds administrative capabilities to manage Benchling secrets through a REST API, enabling programmatic configuration and secret rotation without requiring CDK redeployment.

## Objectives

1. Create admin API endpoints for secret management
2. Enable secure secret updates without stack redeployment
3. Provide programmatic interface for secret rotation
4. Support secret validation and testing
5. Audit secret access and modifications

## Design Decisions

### Decision 1: API Gateway with Lambda Authorizer

**Choice**: Use API Gateway REST API with Lambda authorizer for admin endpoints

**Rationale**:
- Separate admin API from public webhook API
- Custom authorization logic for administrative access
- Integration with AWS Secrets Manager API
- Audit trail through CloudWatch logs
- No infrastructure changes to existing webhook service

**Alternatives Considered**:
- Extend existing ALB with auth middleware (rejected: couples admin with public API)
- CLI-only management (rejected: not programmatic)
- AWS Systems Manager Parameter Store (rejected: less suitable for secrets)

### Decision 2: IAM-Based Authorization

**Choice**: Use IAM authentication with API Gateway IAM authorizer

**Rationale**:
- Leverages existing AWS IAM infrastructure
- No additional authentication system needed
- Fine-grained permission control
- Integrates with existing AWS security model
- Audit trail through CloudTrail

**Alternatives Considered**:
- API keys (rejected: less secure, harder to manage)
- Cognito user pools (rejected: unnecessary complexity)
- Custom auth (rejected: reinventing the wheel)

### Decision 3: Read-Only API Initially

**Choice**: Phase 5 provides READ-ONLY access to secret metadata

**Rationale**:
- Lower security risk for initial implementation
- Validates API design before write operations
- Provides immediate value (secret discovery, validation status)
- Write operations can be added in future phase if needed

**Future Enhancement**:
- Phase 5.1: Add PUT/POST endpoints for secret updates
- Implement two-person approval for secret changes
- Add secret versioning and rollback

### Decision 4: Secret Metadata Only

**Choice**: API returns secret metadata, not actual secret values

**Rationale**:
- Security: Never expose secret values via API
- Compliance: Maintains principle of least privilege
- Practical: Metadata is sufficient for most admin needs (validation status, last updated, etc.)

**Metadata Returned**:
- Secret ARN
- Secret name
- Last modified timestamp
- Last rotation date
- Validation status (structure valid/invalid)
- Fields present (keys only, no values)
- Version information

## Architecture

### Component Diagram

```
┌─────────────────┐
│   Admin User    │
│   (AWS IAM)     │
└────────┬────────┘
         │
         │ AWS SigV4
         ▼
┌─────────────────────────────────┐
│   API Gateway (Admin API)       │
│   - IAM Authorizer              │
│   - Resource Policy             │
└────────┬────────────────────────┘
         │
         │ Lambda Invoke
         ▼
┌─────────────────────────────────┐
│   Admin Lambda Function         │
│   - Get Secret Metadata         │
│   - Validate Secret Structure   │
│   - List Configured Secrets     │
└────────┬────────────────────────┘
         │
         │ AWS SDK
         ▼
┌─────────────────────────────────┐
│   AWS Secrets Manager           │
│   benchling-webhook/credentials │
└─────────────────────────────────┘
```

### API Endpoints

#### GET /admin/secrets
**Description**: List all secrets used by the webhook
**Authorization**: IAM (requires `benchling-webhook:ListSecrets`)
**Response**:
```json
{
  "secrets": [
    {
      "arn": "arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling-webhook/credentials",
      "name": "benchling-webhook/credentials",
      "lastModified": "2025-10-30T12:34:56Z",
      "lastRotation": null,
      "validationStatus": "valid",
      "fieldsPresent": ["client_id", "client_secret", "tenant", "app_definition_id"],
      "version": "AWSCURRENT"
    }
  ]
}
```

#### GET /admin/secrets/{secretName}
**Description**: Get metadata for a specific secret
**Authorization**: IAM (requires `benchling-webhook:GetSecretMetadata`)
**Path Parameters**: `secretName` - Name of the secret (URL-encoded)
**Response**:
```json
{
  "arn": "arn:aws:secretsmanager:us-east-1:123456789012:secret:benchling-webhook/credentials",
  "name": "benchling-webhook/credentials",
  "description": "Benchling API credentials for webhook processor",
  "lastModified": "2025-10-30T12:34:56Z",
  "lastRotation": null,
  "lastAccessed": "2025-10-31T08:15:30Z",
  "validationStatus": "valid",
  "validationErrors": [],
  "fieldsPresent": ["client_id", "client_secret", "tenant", "app_definition_id"],
  "version": "AWSCURRENT",
  "versionStages": ["AWSCURRENT"],
  "tags": {
    "Environment": "production",
    "ManagedBy": "benchling-webhook-cdk"
  }
}
```

#### POST /admin/secrets/validate
**Description**: Validate secret structure without deployment
**Authorization**: IAM (requires `benchling-webhook:ValidateSecret`)
**Request Body**:
```json
{
  "secretArn": "arn:aws:secretsmanager:...",
  "secretData": {
    "client_id": "...",
    "client_secret": "...",
    "tenant": "..."
  }
}
```
**Response**:
```json
{
  "valid": true,
  "errors": [],
  "warnings": ["Field 'app_definition_id' is missing but optional"],
  "structure": {
    "client_id": "present",
    "client_secret": "present",
    "tenant": "present",
    "app_definition_id": "missing"
  }
}
```

#### GET /admin/health
**Description**: Health check for admin API
**Authorization**: None (public endpoint)
**Response**:
```json
{
  "status": "healthy",
  "version": "0.6.0",
  "timestamp": "2025-10-31T12:34:56Z"
}
```

### Lambda Function Implementation

**Runtime**: Node.js 18.x (matches CDK stack)
**Memory**: 512 MB
**Timeout**: 30 seconds
**Environment Variables**:
- `SECRET_NAME`: benchling-webhook/credentials
- `AWS_REGION`: Stack region

**IAM Permissions Required**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:DescribeSecret",
        "secretsmanager:GetSecretValue",
        "secretsmanager:ListSecrets"
      ],
      "Resource": [
        "arn:aws:secretsmanager:*:*:secret:benchling-webhook/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

### CDK Integration

**New Construct**: `AdminApiGateway`
**Location**: `lib/admin-api-gateway.ts`

**Stack Props Addition**:
```typescript
export interface BenchlingWebhookStackProps extends cdk.StackProps {
  // Existing props...
  readonly enableAdminApi?: boolean; // Default: false
  readonly adminApiAllowedPrincipals?: string[]; // IAM ARNs allowed to access admin API
}
```

**Stack Integration**:
```typescript
// In BenchlingWebhookStack constructor
if (props.enableAdminApi) {
  this.adminApi = new AdminApiGateway(this, "AdminApi", {
    secret: this.fargateService.benchlingSecret, // Reference to secret
    allowedPrincipals: props.adminApiAllowedPrincipals || [],
  });

  new cdk.CfnOutput(this, "AdminApiEndpoint", {
    value: this.adminApi.api.url,
    description: "Admin API endpoint for secret management",
  });
}
```

## Security Considerations

### 1. IAM Authorization
- API Gateway uses IAM authorizer
- Requires AWS SigV4 signed requests
- Only authorized IAM principals can access
- Resource-based policies restrict access

### 2. No Secret Values Exposed
- API returns metadata only
- Never returns actual secret values (client_id, client_secret, etc.)
- Field names returned, not field values
- Validation errors don't include sensitive data

### 3. Audit Trail
- All API calls logged to CloudWatch
- CloudTrail captures IAM activity
- Secret access logged by Secrets Manager
- Failed authorization attempts logged

### 4. Network Security
- Admin API endpoint separate from webhook endpoint
- Can be deployed in private subnet (future enhancement)
- Resource policy restricts source IPs (optional)
- Rate limiting via API Gateway

### 5. Least Privilege
- Lambda function has minimal IAM permissions
- Read-only access to Secrets Manager
- No write permissions in Phase 5
- Scoped to benchling-webhook/* secrets only

## Testing Strategy

### Unit Tests
```typescript
describe('AdminApiHandler', () => {
  test('GET /admin/secrets returns secret metadata', async () => {
    const response = await handler({
      httpMethod: 'GET',
      path: '/admin/secrets',
      requestContext: { authorizer: { principalId: 'test-user' } }
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.secrets).toHaveLength(1);
    expect(body.secrets[0].name).toBe('benchling-webhook/credentials');
    expect(body.secrets[0]).not.toHaveProperty('client_id');
  });

  test('POST /admin/secrets/validate validates secret structure', async () => {
    const response = await handler({
      httpMethod: 'POST',
      path: '/admin/secrets/validate',
      body: JSON.stringify({
        secretData: {
          client_id: 'test',
          client_secret: 'test',
          tenant: 'test'
        }
      }),
      requestContext: { authorizer: { principalId: 'test-user' } }
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.valid).toBe(true);
  });
});
```

### Integration Tests
```typescript
describe('Admin API Integration', () => {
  test('requires IAM authentication', async () => {
    const response = await fetch(adminApiUrl + '/admin/secrets');
    expect(response.status).toBe(403); // Forbidden without auth
  });

  test('returns secret metadata for authorized user', async () => {
    const signedRequest = await signRequest('GET', '/admin/secrets');
    const response = await fetch(adminApiUrl + '/admin/secrets', signedRequest);
    expect(response.status).toBe(200);
  });
});
```

### Security Tests
```typescript
describe('Admin API Security', () => {
  test('does not expose secret values', async () => {
    const response = await authorizedGet('/admin/secrets/benchling-webhook-credentials');
    const secret = JSON.parse(response.body);
    expect(secret).not.toHaveProperty('client_id');
    expect(secret).not.toHaveProperty('client_secret');
    expect(secret.fieldsPresent).toContain('client_id');
  });

  test('validates IAM authorization', async () => {
    const unauthorizedResponse = await unauthorizedGet('/admin/secrets');
    expect(unauthorizedResponse.statusCode).toBe(403);
  });
});
```

## Implementation Checklist

See `03-checklist.md` for detailed implementation steps.

## Rollout Strategy

### Phase 5.0 (This Phase)
- ✅ Read-only admin API
- ✅ Secret metadata endpoints
- ✅ Validation endpoint
- ✅ IAM authorization
- ✅ CloudWatch logging

### Phase 5.1 (Future Enhancement)
- ⏳ Secret update endpoints (PUT/POST)
- ⏳ Secret rotation triggering
- ⏳ Secret versioning and rollback
- ⏳ Two-person approval workflow
- ⏳ Secret expiration policies

### Phase 5.2 (Future Enhancement)
- ⏳ Admin UI (web console)
- ⏳ Secret health dashboard
- ⏳ Rotation scheduling
- ⏳ Compliance reporting
- ⏳ Secret usage analytics

## Success Metrics

- ✅ Admin API accessible via IAM authentication
- ✅ Secret metadata returned (no values exposed)
- ✅ Validation endpoint validates secret structure
- ✅ All API calls audited in CloudWatch/CloudTrail
- ✅ Zero security vulnerabilities
- ✅ API response time < 500ms
- ✅ Integration tests pass 100%
- ✅ Documentation complete

## Documentation Requirements

### User Documentation
- Admin API overview
- Authentication setup (IAM policies)
- API endpoint reference
- Example requests with AWS SigV4
- Troubleshooting guide

### Developer Documentation
- Lambda function architecture
- API Gateway configuration
- IAM policy templates
- Testing procedures
- Security best practices

## Future Considerations

1. **Write Operations**: Add PUT/POST endpoints for secret updates
2. **Secret Rotation**: Trigger rotation via API
3. **Admin UI**: Web-based admin console
4. **Multi-Region**: Support cross-region secret replication
5. **Advanced Auth**: Support multiple auth methods
6. **Rate Limiting**: Per-principal rate limits
7. **Caching**: Cache secret metadata with TTL

## Dependencies

### External
- AWS SDK for JavaScript v3
- API Gateway CDK constructs
- Lambda CDK constructs

### Internal
- Secret validation logic from Phase 1
- Secrets Manager integration from Phases 3-4
- CloudWatch logging infrastructure

## Risk Mitigation

### Risk 1: Unauthorized Access
**Mitigation**: IAM authorization, resource policies, CloudTrail audit

### Risk 2: Information Disclosure
**Mitigation**: Return metadata only, never secret values

### Risk 3: API Performance
**Mitigation**: Lambda provisioned concurrency, API Gateway caching

### Risk 4: Breaking Changes
**Mitigation**: API versioning, backward compatibility tests

---

**Design Status**: ✅ Complete and Ready for Implementation
**Next Step**: Create Episodes (02-episodes.md)
