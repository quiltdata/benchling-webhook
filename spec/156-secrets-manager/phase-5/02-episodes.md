# Phase 5 Episodes: Registry Integration and Admin API

**Phase**: 5 of 8
**Feature**: Admin API for Secrets Configuration
**Date**: 2025-10-31
**Total Episodes**: 8

---

## Episode 1: Lambda Function Foundation

**Objective**: Create the Lambda function handler for admin API

**Duration**: 30 minutes

**Tasks**:
1. Create `lib/lambda/admin-api-handler.ts`
2. Implement request routing logic
3. Add error handling and logging
4. Set up response formatting
5. Add health check endpoint

**Acceptance Criteria**:
- Lambda handler routes requests correctly
- Health check endpoint returns 200 OK
- Errors return proper HTTP status codes
- All requests logged to CloudWatch

**Testing**:
- Unit test for request routing
- Unit test for error handling
- Unit test for response formatting

---

## Episode 2: Secret Metadata Retrieval

**Objective**: Implement secret metadata fetching from Secrets Manager

**Duration**: 45 minutes

**Tasks**:
1. Add AWS SDK Secrets Manager client
2. Implement `getSecretMetadata()` function
3. Parse secret ARN and extract components
4. Retrieve secret description and tags
5. Get last modified timestamp
6. Handle secret not found errors

**Acceptance Criteria**:
- Function retrieves secret metadata successfully
- Returns all metadata fields defined in design
- Handles missing secrets gracefully
- Does not return secret values

**Testing**:
- Unit test with mocked Secrets Manager
- Test secret not found scenario
- Test malformed ARN handling

---

## Episode 3: Secret Validation Logic

**Objective**: Implement secret structure validation using existing Phase 1 validation

**Duration**: 30 minutes

**Tasks**:
1. Import validation functions from `lib/utils/secrets.ts`
2. Create `validateSecretStructure()` function
3. Fetch secret value (for validation only)
4. Validate using existing validators
5. Return validation result without secret values
6. Handle validation errors

**Acceptance Criteria**:
- Validation uses existing Phase 1 logic
- Returns field names present (not values)
- Returns validation errors and warnings
- Never exposes secret values in response

**Testing**:
- Unit test with valid secret
- Unit test with invalid secret
- Test that secret values not in response

---

## Episode 4: API Endpoints Implementation

**Objective**: Implement all admin API endpoints

**Duration**: 60 minutes

**Tasks**:
1. Implement `GET /admin/secrets` endpoint
2. Implement `GET /admin/secrets/{secretName}` endpoint
3. Implement `POST /admin/secrets/validate` endpoint
4. Implement `GET /admin/health` endpoint
5. Add request validation
6. Add response sanitization (ensure no secret values)

**Acceptance Criteria**:
- All endpoints return correct responses
- Requests validated before processing
- Responses never contain secret values
- Error messages helpful and secure

**Testing**:
- Unit test for each endpoint
- Test with valid and invalid requests
- Verify response sanitization

---

## Episode 5: CDK Admin API Gateway Construct

**Objective**: Create CDK construct for Admin API Gateway

**Duration**: 90 minutes

**Tasks**:
1. Create `lib/admin-api-gateway.ts`
2. Define API Gateway REST API
3. Configure IAM authorizer
4. Add Lambda integration
5. Configure resource policies
6. Add CloudWatch logging
7. Add CORS configuration (if needed)
8. Export API endpoint as CloudFormation output

**Acceptance Criteria**:
- API Gateway created with IAM auth
- Lambda integrated correctly
- Resource policies restrict access
- Logging enabled to CloudWatch
- API endpoint exported in stack outputs

**Testing**:
- CDK synth test verifies template
- Integration test deploys and calls API
- Test IAM authorization

---

## Episode 6: IAM Roles and Permissions

**Objective**: Configure IAM roles and policies for admin API

**Duration**: 45 minutes

**Tasks**:
1. Create Lambda execution role
2. Grant Secrets Manager read permissions
3. Grant CloudWatch Logs permissions
4. Create resource policy for API Gateway
5. Document required IAM policies for API users
6. Add least-privilege policy examples

**Acceptance Criteria**:
- Lambda has minimal required permissions
- Secrets Manager access scoped to benchling-webhook/*
- API Gateway resource policy limits access
- User IAM policy templates documented

**Testing**:
- Test Lambda can access Secrets Manager
- Test Lambda can write logs
- Test unauthorized access blocked
- Test authorized access succeeds

---

## Episode 7: Stack Integration

**Objective**: Integrate Admin API into main CDK stack

**Duration**: 45 minutes

**Tasks**:
1. Add `enableAdminApi` prop to `BenchlingWebhookStackProps`
2. Add `adminApiAllowedPrincipals` prop
3. Add CloudFormation parameter for admin API toggle
4. Conditionally create Admin API Gateway
5. Pass secret reference to Admin API construct
6. Add Admin API endpoint to stack outputs
7. Update stack documentation

**Acceptance Criteria**:
- Admin API only created when enabled
- Configuration parameters passed correctly
- Stack outputs include admin API URL
- Backward compatible (disabled by default)

**Testing**:
- CDK synth with admin API enabled
- CDK synth with admin API disabled
- Deploy test with admin API enabled
- Verify stack outputs

---

## Episode 8: Documentation and Examples

**Objective**: Document Admin API usage and provide examples

**Duration**: 60 minutes

**Tasks**:
1. Create `docs/ADMIN_API.md` with comprehensive guide
2. Document all API endpoints
3. Provide AWS SigV4 signing examples
4. Create sample IAM policies
5. Add AWS CLI examples
6. Add SDK examples (TypeScript, Python)
7. Document troubleshooting steps
8. Update main README with admin API section

**Acceptance Criteria**:
- All endpoints documented with examples
- IAM policy examples provided
- AWS CLI usage examples working
- SDK examples tested and working
- Troubleshooting guide complete

**Testing**:
- Verify all examples work
- Test IAM policies grant correct access
- Test AWS CLI commands execute
- Test SDK examples run successfully

---

## Episode Dependencies

```
Episode 1 (Lambda Foundation)
    ↓
Episode 2 (Metadata Retrieval) ← ───┐
    ↓                                │
Episode 3 (Validation) ← ────────────┤
    ↓                                │
Episode 4 (API Endpoints) ← ─────────┤
    ↓                                │
Episode 5 (CDK Construct) ← ─────────┤
    ↓                                │
Episode 6 (IAM Roles) ← ─────────────┤
    ↓                                │
Episode 7 (Stack Integration)        │
    ↓                                │
Episode 8 (Documentation) ← ─────────┘
```

---

## Implementation Order

### Day 1: Foundation (Episodes 1-3)
- Morning: Episode 1 (Lambda Foundation)
- Afternoon: Episode 2 (Metadata Retrieval)
- Evening: Episode 3 (Validation Logic)

### Day 2: API Implementation (Episodes 4-5)
- Morning: Episode 4 (API Endpoints)
- Afternoon: Episode 5 (CDK Construct)

### Day 3: Integration (Episodes 6-8)
- Morning: Episode 6 (IAM Roles)
- Afternoon: Episode 7 (Stack Integration)
- Evening: Episode 8 (Documentation)

**Total Estimated Time**: 6-8 hours of focused development

---

## Testing Strategy Per Episode

### Episode 1-4 (Lambda Code)
- Unit tests with Jest
- Mocked AWS SDK calls
- Test coverage >90%

### Episode 5-7 (CDK Infrastructure)
- CDK synth tests
- Integration tests with actual AWS resources
- Test in isolated test account

### Episode 8 (Documentation)
- Manual verification of examples
- Automated link checking
- Documentation review

---

## Quality Gates

After each episode:
- ✅ All tests pass
- ✅ Code lint clean
- ✅ TypeScript compiles without errors
- ✅ Git commit with conventional commit message
- ✅ Episode checklist updated

After all episodes:
- ✅ Full integration test passes
- ✅ Documentation complete
- ✅ Code review conducted
- ✅ Phase checklist complete
- ✅ Ready for merge

---

## Risk Mitigation

### Episode 1-2 Risk: Lambda Performance
**Mitigation**: Use Lambda provisioned concurrency if needed

### Episode 3 Risk: Validation Logic Changes
**Mitigation**: Use stable imports from Phase 1

### Episode 4-5 Risk: API Gateway Configuration
**Mitigation**: Reference AWS best practices, use CDK L2 constructs

### Episode 6 Risk: IAM Permission Errors
**Mitigation**: Test permissions thoroughly, document clearly

### Episode 7 Risk: Breaking Stack Changes
**Mitigation**: Feature flag (enableAdminApi), backward compatibility tests

### Episode 8 Risk: Incomplete Documentation
**Mitigation**: User testing, feedback loop

---

## Success Criteria

✅ All 8 episodes complete
✅ All tests passing
✅ Admin API functional
✅ IAM authorization working
✅ Documentation comprehensive
✅ Zero security issues
✅ Integration tests pass
✅ Ready for production deployment

---

**Episodes Status**: ✅ Defined and Ready for Implementation
**Next Step**: Create Checklist (03-checklist.md)
