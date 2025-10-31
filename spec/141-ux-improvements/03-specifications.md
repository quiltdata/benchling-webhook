# Specifications Document: UX Improvements

## GitHub Issue Reference

**Issue**: #141 - UX improvements
**Requirements**: `.scratch/141-ux-improvements/01-requirements.md`
**Analysis**: `.scratch/141-ux-improvements/02-analysis.md`

## 1. Executive Summary

This document specifies the desired end state for seven user experience improvements to the Benchling-Quilt integration system. The specifications focus on what the system should do and what outcomes should be achieved, addressing display identifier prominence, URL functionality, navigation clarity, documentation usability, metadata structure, and naming conventions.

The specifications are organized by user story and define architectural goals, success criteria, API contracts, and quality gates without prescribing implementation details.

## 2. Desired End State Overview

Upon completion, the system shall:

1. Prominently display human-readable Display IDs across all user touchpoints
2. Generate functional package revision URLs that correctly open the catalog interface
3. Present clear, accurate navigation labels that reflect package-centric operations
4. Render clickable, descriptive hyperlinks in all documentation files
5. Include explicit array indices in file metadata for improved correlation
6. Provide dictionary-based file metadata for efficient programmatic access
7. Generate package identifiers using DNS-compliant hyphenated naming conventions

All improvements shall maintain backward compatibility where feasible and provide clear migration paths where breaking changes are necessary.

## 3. Specifications by User Story

### 3.1 US-1: Human-Readable Display ID Prominence

#### 3.1.1 Desired End State

The system shall treat Display IDs as the primary human-facing identifier throughout the user experience while maintaining Entry IDs for technical operations.

#### 3.1.2 Display Hierarchy

**Primary Identifier**: Display ID shall be the most prominent identifier presented to users.

**Secondary Identifier**: Entry ID shall remain available in metadata and technical contexts.

**Fallback Behavior**: When Display ID is unavailable, the system shall gracefully fall back to Entry ID with appropriate logging.

#### 3.1.3 Canvas UI Specifications

The Canvas UI shall:

1. Display the Display ID as the primary heading identifier
2. Format package information with Display ID in the most prominent position
3. Present the full package path in secondary or technical contexts
4. Maintain Entry ID in block identifiers for technical routing

**Expected Output Format**:
```
## [Display ID]

[Display ID] - [Package Name]: [Catalog Link] [Sync Link] [Upload Link]
```

#### 3.1.4 README Documentation Specifications

README files shall:

1. Feature Display ID in the primary title position
2. Include entry name when available
3. Present Entry ID in metadata or technical sections
4. Follow a consistent title format hierarchy

**Expected Title Hierarchy**:
1. Display ID (most prominent)
2. Entry name (if available)
3. Package name (technical context)

#### 3.1.5 Metadata Specifications

The `entry.json` file shall include both identifiers:

```json
{
  "display_id": "EXP00001234",
  "entry_id": "etr_abc123xyz",
  "package_name": "benchling/etr_abc123xyz",
  ...
}
```

#### 3.1.6 Package Naming Consideration

**Specification Decision Required**: The system shall either:

**Option A (Conservative)**: Maintain Entry ID in package names (S3 keys) to preserve backward compatibility while featuring Display ID in all UI presentations.

**Option B (User-Centric)**: Transition package names to use Display ID, requiring a migration strategy for existing packages.

**Recommendation**: Option A minimizes risk while achieving primary user experience goals. Option B requires investigation into Display ID uniqueness guarantees within Benchling tenants.

#### 3.1.7 Success Criteria

1. Display IDs appear as primary identifiers in 100% of Canvas UI presentations
2. README titles feature Display ID in the most prominent position
3. Users can identify entries using familiar Benchling identifiers
4. Entry IDs remain accessible for technical operations and debugging
5. Fallback logic prevents failures when Display ID is unavailable

### 3.2 US-2: Functional Package Revision URLs

#### 3.2.1 Desired End State

All package revision URLs shall correctly open the Quilt catalog package revision interface, enabling users to add or update package files.

#### 3.2.2 URL Format Specifications

Upload/revision URLs shall conform to the following pattern:

```
https://[catalog-base-url]/b/[bucket]/packages/[package-name]?action=revisePackage
```

Components:
- `catalog-base-url`: Environment-specific catalog domain
- `bucket`: S3 bucket name
- `package-name`: Full package path (e.g., "benchling/etr_123")
- Query parameter: `action=revisePackage`

#### 3.2.3 Validation Requirements

The system shall:

1. Generate URLs that successfully open the package revision interface
2. Support multiple catalog environments (stable, nightly, production)
3. Encode special characters in URL components appropriately
4. Validate URL generation through integration testing

#### 3.2.4 Error Handling

The system shall:

1. Log URL generation operations for debugging
2. Validate required components (catalog URL, bucket, package name) are present
3. Provide clear error messages if URL generation fails

#### 3.2.5 Success Criteria

1. 100% of generated upload URLs successfully open the revision interface
2. URLs work correctly across all supported catalog environments
3. Integration tests verify URL functionality against live catalogs
4. No user reports of non-functional upload links after deployment

#### 3.2.6 Technical Uncertainty

**Investigation Required**: Current URL format appears correct based on code documentation. Specifications require validation against actual Quilt catalog behavior across different versions (stable, nightly, production) to confirm the pattern is universally correct.

### 3.3 US-3: Clear Package Navigation Labels

#### 3.3.1 Desired End State

Navigation buttons shall use terminology that accurately reflects package-centric operations.

#### 3.3.2 Button Label Specifications

The main package navigation button shall:

1. Display the text "Browse Package" instead of "Browse Files"
2. Maintain identical functionality (opens package file browser)
3. Align terminology with the package-centric data model

#### 3.3.3 Consistency Requirements

All references to this navigation action shall use consistent terminology:

1. Button text: "Browse Package"
2. Button identifiers: May retain technical prefixes (e.g., "browse-files-[id]") for backward compatibility
3. Documentation: Updated to reflect new terminology
4. Comments: Updated to describe "Browse Package" functionality

#### 3.3.4 Success Criteria

1. Button displays "Browse Package" text in 100% of Canvas presentations
2. Button functionality remains unchanged
3. User testing confirms improved clarity
4. No confusion between package-level and file-level operations

### 3.4 US-4: Clickable Documentation URLs

#### 3.4.1 Desired End State

All URLs in generated README files shall be rendered as clickable Markdown hyperlinks with descriptive link text.

#### 3.4.2 Markdown Link Specifications

URLs shall follow Markdown link syntax:

```markdown
[descriptive text](url)
```

#### 3.4.3 Link Formatting Requirements

The system shall generate clickable links for:

1. **Benchling Entry URLs**: Link to view entry in Benchling web interface
   - Format: `[View entry in Benchling](https://benchling.com/...)`

2. **Package Catalog URLs**: Link to browse package in Quilt catalog
   - Format: `[Browse package in Quilt catalog](https://catalog.../packages/...)`

3. **Sync URLs**: Link to QuiltSync download operations
   - Format: `[Download with QuiltSync](quilts://...)`

4. **Revision URLs**: Link to package revision interface
   - Format: `[Add files to this package](https://catalog.../packages/...?action=revisePackage)`

#### 3.4.4 Link Text Requirements

Link text shall:

1. Clearly describe the destination or action
2. Use imperative or descriptive phrasing
3. Avoid bare URLs as link text
4. Be concise (under 60 characters preferred)

#### 3.4.5 Rendering Specifications

Links shall:

1. Render correctly in Quilt catalog web interface
2. Render correctly when viewing raw Markdown files
3. Render correctly in GitHub when README is viewed there
4. Maintain functionality across different Markdown renderers

#### 3.4.6 Success Criteria

1. 100% of URLs in README files use Markdown link syntax
2. All links are clickable in the Quilt catalog interface
3. Link text clearly indicates destination without requiring URL inspection
4. No broken or malformed links in generated documentation

### 3.5 US-5: Indexed File Arrays in Metadata

#### 3.5.1 Desired End State

File metadata arrays shall include explicit zero-based index fields, enabling clear correlation between array position and file identity.

#### 3.5.2 Metadata Structure Enhancement

Each file object in the `files` array shall include an `index` field:

```json
{
  "files": [
    {
      "index": 0,
      "filename": "experiment.csv",
      "s3_key": "...",
      "size": 1024
    },
    {
      "index": 1,
      "filename": "analysis.ipynb",
      "s3_key": "...",
      "size": 2048
    }
  ]
}
```

#### 3.5.3 Index Specifications

Index values shall:

1. Be zero-based integers (0, 1, 2, ...)
2. Be sequential without gaps
3. Correspond to array iteration order
4. Be immutable after metadata generation

#### 3.5.4 Backward Compatibility

This enhancement shall:

1. Be purely additive (no field removals)
2. Not break existing metadata parsers
3. Provide additional information without requiring it

#### 3.5.5 Success Criteria

1. 100% of file entries include an explicit `index` field
2. Index values are sequential and zero-based
3. Existing metadata consumers continue to function without modification
4. Developers can correlate file metadata using index references

### 3.6 US-6: Dictionary-Based File Metadata

#### 3.6.1 Desired End State

File metadata shall be accessible via dictionary structure using filenames as keys, enabling O(1) lookup performance and more intuitive programmatic access.

#### 3.6.2 Metadata Structure Specification

The `entry.json` file shall structure file metadata as a dictionary:

```json
{
  "package_name": "benchling/etr_123",
  "entry_id": "etr_123",
  "display_id": "EXP00001234",
  "files": {
    "experiment.csv": {
      "s3_key": "benchling/.../experiment.csv",
      "size": 1024,
      "uploaded_at": "2025-10-30T12:00:00Z"
    },
    "analysis.ipynb": {
      "s3_key": "benchling/.../analysis.ipynb",
      "size": 2048,
      "uploaded_at": "2025-10-30T12:00:05Z"
    }
  }
}
```

#### 3.6.3 Dictionary Key Specifications

Dictionary keys shall:

1. Use the logical filename as it appears in the package
2. Include relative paths if files are organized in subdirectories
3. Be unique within the package scope
4. Use consistent path separators (forward slash)

#### 3.6.4 Dictionary Value Specifications

Dictionary values shall contain file metadata including:

1. `s3_key`: Full S3 object key
2. `size`: File size in bytes
3. Additional metadata as appropriate (upload timestamp, content type, etc.)

#### 3.6.5 Ordering Preservation

The system shall:

1. Leverage Python 3.7+ dictionary ordering guarantees
2. Maintain file insertion order in the dictionary
3. Preserve chronological upload order where applicable

#### 3.6.6 Migration Strategy Specification

**Breaking Change Acknowledgment**: This change represents a structural modification to the metadata format.

The system shall provide:

1. **Version Identifier**: Add `metadata_version` field to entry.json
   ```json
   {
     "metadata_version": "2.0",
     "files": { ... }
   }
   ```

2. **Migration Path Options**:
   - **Option A (Hard Cutover)**: Transition all new packages to dictionary format immediately
   - **Option B (Dual Format)**: Temporarily support both array and dictionary formats
   - **Option C (Versioned Read)**: Readers detect format and parse accordingly

3. **Documentation**: Comprehensive migration guide for metadata consumers

#### 3.6.7 Backward Compatibility Considerations

**Known Breaking Change**: Code that iterates over `files` as an array will fail.

Mitigation strategies:

1. Provide utility functions for metadata parsing
2. Document the breaking change clearly
3. Update all internal consumers before release
4. Provide clear migration timeline

#### 3.6.8 Success Criteria

1. File metadata accessible via dictionary lookup in O(1) time
2. Dictionary structure maintains file ordering
3. All internal consumers successfully updated to new format
4. Migration documentation clearly explains changes and provides examples
5. `metadata_version` field enables format detection

#### 3.6.9 Technical Risk

**High Risk**: Unknown external consumers of entry.json format may break. Requires careful rollout planning and versioning strategy.

### 3.7 US-7: Catalog-Aligned Package Identifiers

#### 3.7.1 Desired End State

CLI-generated package identifiers shall use hyphenated naming conventions that align with DNS standards and Quilt catalog conventions.

#### 3.7.2 Identifier Format Specifications

Package identifiers shall:

1. Use hyphens as word separators (e.g., "quilt-integration")
2. Conform to DNS naming conventions:
   - Lowercase alphanumeric characters
   - Hyphens for word separation
   - No underscores, spaces, or special characters
   - Start and end with alphanumeric characters

3. Be consistent across all system components:
   - CLI manifest generation
   - Package naming conventions
   - Feature identifiers
   - Configuration keys

#### 3.7.3 Manifest Feature ID Specifications

The Benchling app manifest shall use hyphenated feature identifiers:

```yaml
features:
  - name: Quilt Package
    id: quilt-integration  # Not quilt_entry
    type: CANVAS
```

#### 3.7.4 Migration Considerations

**Potential Breaking Change**: Changing feature IDs may affect existing app installations.

The system shall:

1. Document the identifier change
2. Assess impact on existing Benchling app installations
3. Provide migration guidance if feature ID changes affect app behavior
4. Validate new identifiers against Benchling app manifest requirements

#### 3.7.5 Naming Convention Documentation

Documentation shall specify:

1. Hyphenated naming as the standard convention
2. Rationale for DNS alignment (catalog compatibility, URL friendliness)
3. Examples of correct and incorrect identifier formats
4. Validation rules for identifier generation

#### 3.7.6 Success Criteria

1. 100% of CLI-generated identifiers use hyphenated format
2. Feature IDs conform to DNS naming conventions
3. Identifiers are consistent across manifest, config, and documentation
4. Validation prevents generation of non-conforming identifiers
5. Migration path defined for existing installations (if applicable)

#### 3.7.7 Technical Uncertainty

**Investigation Required**: Determine whether Benchling app manifest validation accepts hyphenated feature IDs and whether changing feature IDs affects existing installations.

## 4. Cross-Cutting Specifications

### 4.1 Architectural Goals

#### 4.1.1 Separation of Concerns

The system shall maintain clear separation between:

1. **Presentation Layer**: Canvas UI formatting and user-facing content
2. **Business Logic Layer**: Package creation, metadata generation
3. **Data Layer**: S3 storage, metadata structures
4. **Integration Layer**: Benchling API, Quilt catalog interactions

#### 4.1.2 Configuration Management

Display preferences and formatting rules shall be:

1. Centralized in configuration modules
2. Environment-independent where possible
3. Overridable through environment variables where appropriate
4. Documented with clear default values

#### 4.1.3 Error Handling

The system shall:

1. Handle missing Display IDs gracefully with fallback to Entry ID
2. Log all identifier resolution operations for debugging
3. Validate URL generation components before construction
4. Provide clear error messages for metadata format issues

### 4.2 Design Principles

#### 4.2.1 User-Centric Identifiers

Prioritize identifiers that match user mental models and Benchling UI conventions (Display IDs) over system-internal identifiers (Entry IDs).

#### 4.2.2 Progressive Enhancement

Changes shall enhance existing functionality without removing capabilities:

1. Display ID prominence enhances clarity without removing Entry ID access
2. Indexed arrays add information without changing structure
3. Clickable links improve usability without changing content

#### 4.2.3 Graceful Degradation

When enhancements cannot be applied (e.g., Display ID unavailable):

1. Fall back to previous behavior
2. Log the degradation for monitoring
3. Maintain functional correctness

#### 4.2.4 Consistency Across Touchpoints

Formatting, terminology, and presentation patterns shall be consistent across:

1. Canvas UI blocks
2. README documentation
3. JSON metadata
4. CLI output
5. URL generation

### 4.3 Quality Gates

#### 4.3.1 Code Quality Standards

Changes shall meet or exceed existing quality metrics:

1. **Test Coverage**: Maintain or exceed 85% overall coverage
2. **Type Hints**: 100% of new public functions shall include type hints
3. **Documentation**: All modified functions shall have updated docstrings
4. **Linting**: Zero linting errors from ruff or configured linters

#### 4.3.2 Functional Testing Requirements

Each user story shall have:

1. **Unit Tests**: Test individual functions in isolation
2. **Integration Tests**: Test component interactions
3. **End-to-End Tests**: Validate complete workflows where feasible

#### 4.3.3 Validation Criteria

Before deployment, the system shall demonstrate:

1. **Display ID Resolution**: 100% success rate in test cases
2. **URL Functionality**: Manual validation that generated URLs work
3. **Markdown Rendering**: Visual verification of clickable links
4. **Metadata Parsing**: Successful parsing by test consumers

### 4.4 Integration Points and API Contracts

#### 4.4.1 Benchling SDK Integration

The system shall interact with Benchling SDK to:

**Input Contract**:
- Receive webhook payloads containing entry events
- Accept entry IDs for data retrieval

**Output Contract**:
- Fetch entry data including Display ID
- Retrieve entry export data (files, metadata)

**Error Handling**:
- Handle API failures with retry logic
- Fall back to Entry ID when Display ID unavailable
- Log all API interactions for debugging

#### 4.4.2 Quilt Catalog Integration

The system shall generate URLs conforming to Quilt catalog expectations:

**URL Contract**:
- Catalog browsing: `https://[catalog]/b/[bucket]/packages/[package]`
- Package revision: `https://[catalog]/b/[bucket]/packages/[package]?action=revisePackage`
- QuiltSync download: `quilts://[bucket]/[package]`

**Validation**:
- URLs shall open correct catalog interfaces
- Query parameters shall trigger expected actions
- Multi-environment support (stable, nightly, production)

#### 4.4.3 Canvas UI Integration

The system shall generate Canvas UI blocks conforming to:

**Block Structure Contract**:
- Use `benchling_api_client` UI block types
- Include required fields for all block types
- Generate valid block identifiers

**Content Contract**:
- Markdown content shall render correctly in Benchling Canvas
- Links shall be clickable within Canvas interface
- Formatting shall be consistent with Benchling conventions

#### 4.4.4 Metadata Consumer Contract

The `entry.json` file shall provide:

**Required Fields** (Stable Contract):
```json
{
  "metadata_version": "2.0",
  "package_name": "string",
  "entry_id": "string",
  "display_id": "string",
  "name": "string | null",
  "web_url": "string",
  "created_at": "ISO 8601 timestamp",
  "modified_at": "ISO 8601 timestamp",
  "export_timestamp": "ISO 8601 timestamp"
}
```

**Files Field Contract** (Version 2.0):
```json
{
  "files": {
    "[filename]": {
      "s3_key": "string",
      "size": "integer (bytes)"
    }
  }
}
```

**Versioning Contract**:
- `metadata_version` field indicates format version
- Consumers shall check version and parse accordingly
- Future versions shall maintain backward-compatible required fields or increment major version

### 4.5 Performance Requirements

#### 4.5.1 Canvas Update Latency

Canvas UI updates shall complete within:

1. **Target**: < 2 seconds for 90th percentile
2. **Maximum**: < 5 seconds for 99th percentile
3. **Timeout**: 10 seconds before failure

#### 4.5.2 Package Creation Performance

Package creation workflow shall:

1. Return acknowledgment to Benchling within 10 seconds
2. Complete background processing within 60 seconds for typical entry sizes
3. Handle large file sets (100+ files) within 5 minutes

#### 4.5.3 Metadata Access Performance

Dictionary-based file metadata shall provide:

1. O(1) lookup time for file metadata by filename
2. No performance degradation compared to array-based approach for full iteration
3. Minimal memory overhead for dictionary structure

### 4.6 Security and Validation

#### 4.6.1 Input Validation

The system shall validate:

1. **Display IDs**: Format matches Benchling Display ID patterns
2. **Entry IDs**: Format matches Benchling Entry ID patterns
3. **URLs**: Components are properly encoded
4. **Filenames**: No path traversal or injection risks

#### 4.6.2 Data Sanitization

Generated content shall:

1. Escape special characters in Markdown appropriately
2. Encode URL components correctly
3. Prevent injection attacks through user-controlled strings

#### 4.6.3 Credential Handling

The system shall:

1. Never include credentials or tokens in generated URLs
2. Use secure token refresh mechanisms
3. Log operations without exposing sensitive data

## 5. Success Metrics

### 5.1 Functional Success Metrics

Each user story shall be measured against its acceptance criteria:

**US-1 (Display ID Prominence)**:
- Metric: Percentage of Canvas UI presentations featuring Display ID as primary identifier
- Target: 100%

**US-2 (Package Revision URLs)**:
- Metric: Percentage of generated upload URLs that successfully open revision interface
- Target: 100%

**US-3 (Navigation Labels)**:
- Metric: Consistency of "Browse Package" label across all instances
- Target: 100%

**US-4 (Clickable URLs)**:
- Metric: Percentage of URLs in README formatted as Markdown links
- Target: 100%

**US-5 (Indexed Arrays)**:
- Metric: Percentage of file entries with valid index fields
- Target: 100%

**US-6 (Dictionary Metadata)**:
- Metric: Adoption rate of dictionary-based metadata format
- Target: 100% of new packages

**US-7 (Hyphenated Identifiers)**:
- Metric: Conformance of generated identifiers to DNS conventions
- Target: 100%

### 5.2 Quality Metrics

**Test Coverage**:
- Metric: Line coverage percentage
- Target: >= 85% overall, >= 90% for modified modules

**Defect Rate**:
- Metric: Post-deployment bugs per user story
- Target: < 1 per user story in first 30 days

**Backward Compatibility**:
- Metric: Percentage of existing functionality preserved
- Target: 100% except documented breaking changes (US-6)

### 5.3 User Experience Metrics

**Clarity Improvement**:
- Metric: User feedback on identifier recognition
- Target: Positive feedback from 80%+ of surveyed users

**Navigation Effectiveness**:
- Metric: Time to locate package browsing functionality
- Target: No increase from baseline

**Documentation Usability**:
- Metric: Percentage of users successfully navigating links
- Target: 100% success rate in user testing

### 5.4 Performance Metrics

**Canvas Load Time**:
- Metric: Time to render Canvas UI with Display ID
- Target: No measurable increase from baseline (< 100ms delta)

**Metadata Parse Time**:
- Metric: Time to parse dictionary-based metadata
- Target: Equal or faster than array-based approach

## 6. Validation and Testing Strategy

### 6.1 Unit Testing Specifications

Each modified module shall have unit tests that:

1. Test Display ID formatting logic
2. Test URL generation with various inputs
3. Test metadata structure generation
4. Test Markdown formatting functions
5. Achieve >= 90% line coverage for modified code

### 6.2 Integration Testing Specifications

Integration tests shall validate:

1. **Benchling SDK Integration**: Display ID retrieval from API
2. **Canvas UI Rendering**: Markdown and blocks render correctly
3. **URL Functionality**: Generated URLs open correct interfaces (manual validation)
4. **Metadata Consistency**: Generated metadata matches schema

### 6.3 End-to-End Testing Specifications

E2E tests shall validate complete workflows:

1. **Entry Creation Workflow**:
   - Webhook received → Entry exported → Package created → Canvas updated
   - Display ID prominent in Canvas UI
   - README includes clickable links
   - Metadata uses dictionary structure

2. **Package Update Workflow**:
   - User clicks upload link → Revision interface opens → Files added → Package updated
   - Updated package maintains metadata format

3. **Package Discovery Workflow**:
   - User searches by Display ID → Package found → Package browsable
   - Navigation labels clear and accurate

### 6.4 Regression Testing Specifications

Regression tests shall ensure:

1. Existing packages remain accessible after deployment
2. Legacy metadata consumers continue to function (until deprecated)
3. URL formats work across all catalog environments
4. Performance metrics remain within acceptable ranges

### 6.5 User Acceptance Testing Specifications

UAT shall validate:

1. **Display ID Recognition**: Users correctly identify entries by Display ID
2. **Link Functionality**: Users successfully navigate using generated links
3. **Navigation Clarity**: Users understand button labels and actions
4. **Metadata Accessibility**: Developers successfully parse new metadata format

## 7. Deployment and Rollout Specifications

### 7.1 Phased Rollout Strategy

**Phase 1: Non-Breaking Changes**
- US-1: Display ID prominence (UI/documentation only)
- US-3: Button label updates
- US-4: URL linkification
- US-5: Indexed file arrays (additive)
- US-7: Hyphenated identifiers (new manifests only)

**Phase 2: URL Validation**
- US-2: Package revision URL validation and fixes (if needed)

**Phase 3: Breaking Changes**
- US-6: Dictionary-based metadata (versioned rollout)

### 7.2 Rollback Specifications

The system shall support rollback for:

1. **UI Changes**: Revert Canvas formatting to previous version
2. **Metadata Format**: Maintain ability to read version 1.0 format
3. **URL Generation**: Revert to previous URL patterns if needed

**Non-Rollback Items**:
- Metadata already written in version 2.0 format (forward-only migration)

### 7.3 Monitoring Requirements

Post-deployment monitoring shall track:

1. **Error Rates**: Canvas update failures, metadata generation errors
2. **URL Functionality**: Click-through rates on generated URLs
3. **API Performance**: Display ID fetch latency and success rates
4. **Metadata Format Distribution**: Version 1.0 vs 2.0 adoption

## 8. Documentation Requirements

### 8.1 User Documentation

Documentation shall be created or updated for:

1. **Display ID Usage**: Explanation of Display ID prominence and Entry ID availability
2. **Package Navigation**: Updated guides reflecting "Browse Package" terminology
3. **Metadata Format**: Specification of version 2.0 dictionary structure
4. **Migration Guide**: Instructions for updating metadata consumers

### 8.2 Developer Documentation

Developer documentation shall specify:

1. **Metadata Schema**: JSON schema for entry.json version 2.0
2. **URL Patterns**: Catalog URL format requirements
3. **API Contracts**: Benchling SDK usage patterns
4. **Testing Procedures**: How to validate changes

### 8.3 Changelog

Release notes shall document:

1. Enhanced Display ID presentation
2. Improved documentation link formatting
3. Indexed file arrays (backward compatible)
4. Dictionary-based file metadata (breaking change)
5. Hyphenated identifier conventions

## 9. Open Questions and Risks

### 9.1 Technical Uncertainties

**Q1: Display ID Uniqueness**
- Question: Are Display IDs unique within a Benchling tenant?
- Impact: Affects feasibility of using Display ID in package names (US-1 extension)
- Resolution: Requires investigation before deciding on package naming strategy

**Q2: Display ID Availability**
- Question: Is Display ID always available in all webhook event types?
- Impact: Affects fallback logic and error handling requirements
- Resolution: Audit webhook payloads across all subscribed event types

**Q3: Quilt Catalog URL Compatibility**
- Question: Do current URL patterns work across all catalog versions?
- Impact: May require version detection or environment-specific URL generation
- Resolution: Integration testing against stable, nightly, and production catalogs

**Q4: Metadata Consumer Inventory**
- Question: What external systems consume entry.json format?
- Impact: Determines severity of breaking change (US-6) and migration urgency
- Resolution: Survey stakeholders and search for references in related repositories

**Q5: Benchling Feature ID Constraints**
- Question: Does Benchling manifest validation accept hyphenated feature IDs?
- Impact: May require alternative approach to DNS-aligned naming
- Resolution: Test manifest with hyphenated IDs in Benchling app installation process

### 9.2 Architectural Risks

**Risk 1: Package Naming Migration** (US-1 extension)
- Severity: High
- Description: Changing package names affects S3 keys and existing references
- Mitigation: Recommend Option A (maintain Entry ID in package names) until Display ID uniqueness confirmed

**Risk 2: Metadata Format Breaking Change** (US-6)
- Severity: High
- Description: Dictionary structure breaks code expecting arrays
- Mitigation: Use versioning, provide migration tools, clear communication timeline

**Risk 3: Display ID Retrieval Latency** (US-1)
- Severity: Medium
- Description: API calls to fetch Display ID may slow Canvas updates
- Mitigation: Implement caching, measure latency, set performance budgets

**Risk 4: URL Pattern Assumptions** (US-2)
- Severity: Medium
- Description: Current URL patterns may not work in all environments
- Mitigation: Validate against multiple catalog versions before finalizing

**Risk 5: Feature ID Migration** (US-7)
- Severity: Medium
- Description: Changing feature ID may affect existing app installations
- Mitigation: Test impact, provide migration guide if needed

### 9.3 Dependency Risks

**Benchling SDK**:
- Risk: API changes affect Display ID retrieval
- Mitigation: Monitor SDK releases, maintain version compatibility

**Quilt Catalog**:
- Risk: URL format changes in future catalog versions
- Mitigation: Document version requirements, test against pre-release versions

**Python 3.7+ Dictionary Ordering**:
- Risk: Runtime environment using Python < 3.7
- Mitigation: Enforce Python 3.7+ in deployment requirements

## 10. Acceptance Criteria Summary

The implementation shall be considered complete when:

1. **US-1**: Display IDs appear as primary identifiers in Canvas UI and README titles
2. **US-2**: Upload links successfully open package revision interface (validated manually)
3. **US-3**: Navigation button displays "Browse Package" consistently
4. **US-4**: README URLs are clickable Markdown links with descriptive text
5. **US-5**: File metadata includes sequential zero-based index fields
6. **US-6**: New packages use dictionary-based file metadata with version identifier
7. **US-7**: CLI generates hyphenated identifiers conforming to DNS conventions

All changes shall:
- Maintain or exceed 85% test coverage
- Pass all existing regression tests
- Meet performance requirements (< 100ms Canvas latency increase)
- Include updated documentation
- Provide migration guides for breaking changes

## 11. Non-Functional Requirements

### 11.1 Maintainability

Code changes shall:
- Follow established project conventions and idioms
- Include comprehensive docstrings with examples
- Use type hints for all public functions
- Separate concerns appropriately (presentation/business logic/data)

### 11.2 Observability

The system shall provide:
- Structured logging for identifier resolution operations
- Metrics for Display ID fetch success rates
- Error tracking for URL generation failures
- Metadata version distribution monitoring

### 11.3 Extensibility

The design shall:
- Support future metadata format versions through versioning field
- Allow additional URL types without restructuring
- Enable configuration-based display preferences
- Permit extending metadata fields without breaking existing parsers

### 11.4 Internationalization Considerations

While not currently internationalized, the design shall:
- Use Unicode-safe string operations
- Avoid hard-coded English strings in data structures (UI labels acceptable)
- Support Display IDs with international characters if Benchling supports them

## 12. Conclusion

These specifications define the desired end state for seven interconnected UX improvements to the Benchling-Quilt integration. The specifications prioritize user experience through human-readable identifiers, functional URLs, clear navigation, and accessible metadata structures while maintaining system reliability through careful attention to backward compatibility, performance, and testing requirements.

The phased approach separates low-risk enhancements from higher-risk breaking changes, enabling iterative delivery and validation. Open questions and risks are clearly identified, requiring investigation and decision-making before or during implementation.

Success will be measured through functional metrics (100% conformance to specified formats), quality metrics (>= 85% test coverage), and user experience validation (positive feedback on clarity improvements).
