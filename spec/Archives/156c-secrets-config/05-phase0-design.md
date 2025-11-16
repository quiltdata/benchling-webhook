# Phase 0 Design: Pre-factoring for Configuration System Refactoring

**Specification**: `spec/156c-secrets-config/03-specifications.md`
**Phases Plan**: `spec/156c-secrets-config/04-phases.md`
**Phase**: Phase 0 - Pre-factoring
**Status**: Design
**Last Updated**: 2025-11-02

---

## Overview

This document provides the technical design for Phase 0 of the configuration system refactoring, focusing on establishing a robust, standardized configuration management approach using XDG-compliant configuration files and CLI-based inference.

### Goals

1. Establish three-file XDG configuration strategy
2. Remove all backward compatibility and migration support
3. Implement CLI-based configuration inference
4. Enhance configuration validation and authentication
5. Support multi-profile configuration management

### Success Criteria

- Three-file XDG configuration structure implemented
- No legacy configuration support
- CLI-driven configuration discovery and validation
- Robust authentication and configuration verification
- Multi-profile support with clear management patterns

---

## XDG Configuration Architecture

### Configuration Files

1. `~/.config/benchling-webhook/default.json`
   - **Purpose**: User-provided default configuration
   - **Managed by**: User
   - **Contains**: Static configuration parameters
   - **Example Fields**:
     ```json
     {
       "quilt_catalog": "https://quilt.example.com",
       "default_profile": "personal"
     }
     ```

2. `~/.config/benchling-webhook/config/default.json`
   - **Purpose**: Derived configuration from CLI inference
   - **Managed by**: Configuration inference script
   - **Contains**: Dynamically resolved configuration
   - **Example Fields**:
     ```json
     {
       "aws_region": "us-east-1",
       "s3_bucket": "my-quilt-bucket",
       "quilt_database": "research"
     }
     ```

3. `~/.config/benchling-webhook/deploy/default.json`
   - **Purpose**: Deployment-specific configuration
   - **Managed by**: Deployment process
   - **Contains**: Ephemeral deployment artifacts
   - **Example Fields**:
     ```json
     {
       "webhook_url": "https://api.example.com/webhook",
       "deployment_timestamp": "2025-11-02T14:30:00Z",
       "stack_arn": "arn:aws:cloudformation:..."
     }
     ```

### CLI Configuration Inference

#### Configuration Discovery Process

1. **Quilt Catalog Inference**
   - Use `quilt3 config` to read default catalog
   - Extract S3 bucket, region, and database information
   - Validate catalog accessibility

2. **Benchling Authentication**
   - Interactive CLI prompts for:
     * Tenant name
     * Client ID
     * Client secret
   - Validate credentials by making a test API call
   - Store validated credentials securely

3. **S3 Bucket Verification**
   - Use AWS CLI to validate S3 bucket access
   - Confirm read/write permissions
   - Extract additional metadata

#### Multi-Profile Support

- Support creating named profiles via CLI
- Allow switching between profiles
- Store profile configurations in separate JSON files
- Implement profile-level credential management

### Configuration Validation Strategy

1. **Static Validation**
   - JSON schema validation for all configuration files
   - Enforce strict typing
   - Prevent incomplete or invalid configurations

2. **Runtime Validation**
   - Authenticate against Benchling API
   - Verify S3 bucket permissions
   - Check AWS credential validity
   - Validate required configuration parameters

3. **Error Handling**
   - Provide clear, actionable error messages
   - Suggest remediation steps
   - Support verbose logging for troubleshooting

---

## Implementation Details

### Technology Preferences

- **Configuration Management**: npm-based scripts
- **Inference**: Native TypeScript implementations
- **Authentication**: AWS SDK and Benchling API libraries
- **Validation**: JSON Schema, runtime type checking

### Scope and Limitations

- **NO** support for `.env` files
- **NO** automatic migration from existing configurations
- **NO** environment variable fallback mechanisms
- **FULL** CLI-driven configuration management

---

## Risks and Mitigations

### Configuration Discovery Risks

- **Risk**: Unable to infer Quilt configuration
  - **Mitigation**: Explicit CLI prompts
  - **Fallback**: Manual configuration entry

- **Risk**: Benchling credential validation failure
  - **Mitigation**: Comprehensive error messages
  - **Fallback**: Step-by-step configuration guidance

### Security Considerations

- Store credentials using system-level secure storage
- Implement credential rotation mechanisms
- Minimal persistence of sensitive information
- Support for hardware security modules (HSM)

---

## Next Steps

1. Develop npm configuration inference script
2. Create JSON schema for configuration files
3. Implement CLI interface for profile management
4. Design comprehensive validation framework

---

## Document Control

**Version**: 1.1
**Author**: Business Analyst
**Status**: Design Review
**Next Phase**: Detailed Implementation
**Reviewers**: TBD
**Approval**: TBD