## 9. Open Technical Questions

### 9.1 Questions Requiring Resolution Before Implementation

**Question 1: XDG Configuration Multi-Profile Support**
- DECISION: Support multiple profiles via manual profile-specific files
- Profiles must be created manually
- Each profile requires separate XDG file creation
- Include AWS_PROFILE name in configuration

**Question 2: Offline Mode**
- DECISION: NO offline mode support
- All operations require network connectivity
- No mock data generation
- Minimum viable network access: AWS Secrets Manager and Quilt catalog API

**Question 3: Configuration Encryption**
- DECISION: NO local XDG configuration encryption
- Rely on AWS Secrets Manager for encryption
- File system permissions (0600) as primary protection mechanism
- No additional encryption libraries introduced

**Question 4: Docker Registry Customization**
- DECISION: Allow ECR_REPOSITORY_NAME override
- No support for external registries
- Default to auto-generated repository name
- CI/CD builds push to default repository

**Question 5: Configuration Versioning**
- DECISION: NO native versioning mechanism
- Configuration schema version tracked in schema itself
- No automated migration between schema versions
- Manual intervention required for schema changes

**Question 6: Secret Rotation**
- DECISION: MANUAL secret rotation only
- NO automatic credential management
- Recommend regular manual rotation via AWS Secrets Manager
- Provide clear documentation on manual rotation process

**Question 7: Secret Sync Strategy**
- DECISION: Single source of truth is AWS Secrets Manager
- XDG configuration tracks ONLY ARN references
- No local caching of secret values
- Resolved at runtime via AWS API calls

**Question 8: CI/CD Role Limitations**
- DECISION: CI/CD role is BUILD-ONLY
- Creates packages and images
- Does NOT perform deployments
- Users must deploy from their own environments

**Future Considerations**:
- Potential future support for more dynamic configuration
- Investigate advanced AWS credential management
- Explore more sophisticated secret rotation mechanisms
- Gather user feedback on configuration complexity