# Analysis Document: UX Improvements

## GitHub Issue Reference

**Issue**: #141 - UX improvements
**Requirements**: `.scratch/141-ux-improvements/01-requirements.md`

## Executive Summary

This analysis examines the current state of the Benchling-Quilt integration system to identify architectural patterns, constraints, and gaps that must be addressed to implement the seven user stories from the requirements document. The system exhibits well-established patterns for Canvas UI generation, package metadata creation, and URL handling, but requires targeted improvements to enhance user experience across display identifiers, navigation labels, URL formats, and metadata structures.

## 1. Current Architecture Overview

### 1.1 System Component Inventory

The codebase exhibits a modular, separation-of-concerns architecture with the following key components:

1. **Canvas UI Layer** (`docker/src/canvas.py`, `docker/src/canvas_blocks.py`, `docker/src/canvas_formatting.py`)
   - Handles Benchling Canvas interface generation
   - Creates markdown content and UI blocks
   - Manages user interactions and navigation

2. **Entry Packaging Layer** (`docker/src/entry_packager.py`)
   - Exports Benchling entries
   - Creates metadata files (entry.json, README.md, entry_data.json, input.json)
   - Uploads to S3 and queues for Quilt package creation

3. **Package Management Layer** (`docker/src/packages.py`)
   - Generates catalog URLs
   - Generates QuiltSync download URLs
   - Generates package revision/upload URLs

4. **Package Query Layer** (`docker/src/package_query.py`)
   - Queries Athena database for packages
   - Searches by metadata key-value pairs
   - Returns Package instances

5. **CLI Layer** (`bin/commands/manifest.ts`)
   - Generates Benchling app manifests
   - Configures package identifiers

6. **Configuration** (`docker/src/config.py`)
   - Environment-based configuration
   - S3 prefix: defaults to "benchling"
   - Package key: defaults to "experiment_id"

### 1.2 Current Data Flow

```
Benchling Webhook → Payload Parser → Entry Packager → S3 Upload → SQS Queue
                          ↓
                    Canvas Manager → Canvas UI Blocks → Benchling API
```

### 1.3 Testing Infrastructure

The project uses pytest with comprehensive test coverage across:
- Unit tests for individual components
- Integration tests requiring AWS access
- Local-only tests marked with `@pytest.mark.local`
- Test files follow pattern: `tests/test_{module}.py`
- Testing patterns emphasize mocking external dependencies

## 2. Current Implementation Analysis by User Story

### 2.1 US-1: Display Human-Readable Entry Identifiers

#### Current State

**Package Names (Line 278 in payload.py)**:
```python
def package_name(self, s3_prefix: str) -> str:
    return f"{s3_prefix}/{self.entry_id}"
```
- Package names use technical Entry ID (e.g., "benchling/etr_abc123xyz")
- Entry ID is extracted from webhook payload via multiple paths

**Canvas UI (Line 190 in canvas.py)**:
```python
content = fmt.format_package_header(
    package_name=self.package_name,
    display_id=self.entry.display_id,
    catalog_url=self.catalog_url,
    sync_url=self.sync_uri(),
    upload_url=self.upload_url(),
)
```
- Display ID is already fetched via `self.entry.display_id`
- Display ID is passed to formatting function but usage is minimal

**Canvas Formatting (Line 25 in canvas_formatting.py)**:
```python
return f"""## {package_name}

* {display_id}: [{package_name}]({catalog_url}) [[🔄 sync]]({sync_url}) [[⬆️ upload]]({upload_url})
"""
```
- Display ID appears in secondary position after package name in markdown
- Package heading uses technical package_name instead of Display ID

**README Generation (Lines 603-606 in entry_packager.py)**:
```python
title = f"# Benchling Entry Package: {package_name}"
if name:
    title = f"# {name} ({display_id})"
```
- README prioritizes entry name over Display ID when available
- Display ID is shown in parentheses as secondary information

**Metadata Creation (Lines 556-587 in entry_packager.py)**:
```python
validated_fields = validate_entry_data(entry_data, entry_id)
display_id = validated_fields["display_id"]

entry_json = {
    "package_name": package_name,
    "entry_id": entry_id,
    "display_id": display_id,
    # ... other fields
}
```
- Display ID is stored in entry.json metadata
- Display ID validation exists and is enforced
- Both entry_id and display_id are preserved

#### Gaps Identified

1. Display ID is available but not prominently featured in Canvas UI
2. Package names in URLs use Entry ID instead of Display ID
3. README titles don't consistently prioritize Display ID
4. No consistent pattern for Display ID presentation across touchpoints

#### Constraints

1. Display ID must be fetched from Benchling API (not always in webhook payload)
2. Entry ID must remain in metadata for technical reference
3. Package naming convention affects S3 keys and Quilt package structure
4. Changing package names may impact existing package references

### 2.2 US-2: Working Package Revision URLs

#### Current State

**Upload URL Generation (Line 123 in packages.py)**:
```python
@property
def upload_url(self) -> str:
    """Generate upload/revise package URL for adding files.

    Returns:
        Quilt catalog URL with revisePackage action

    Example:
        'https://nightly.quilttest.com/b/my-bucket/packages/benchling/etr_123?action=revisePackage'
    """
    return f"{self.catalog_url}?action=revisePackage"
```

**Catalog URL Generation (Line 52 in packages.py)**:
```python
@property
def catalog_url(self) -> str:
    """Direct link to package in Quilt catalog.

    Returns:
        URL to view package in catalog

    Example:
        'https://nightly.quilttest.com/b/my-bucket/packages/benchling/etr_123'
    """
    return f"https://{self.catalog_base_url}/b/{self.bucket}/packages/{self.package_name}"
```

**Usage in Canvas (Line 195 in canvas.py)**:
```python
upload_url=self.upload_url(),
```

**Canvas Formatting (Line 27 in canvas_formatting.py)**:
```python
* {display_id}: [{package_name}]({catalog_url}) [[🔄 sync]]({sync_url}) [[⬆️ upload]]({upload_url})
```

#### Analysis

The current implementation uses a simple query parameter approach (`?action=revisePackage`). This appears to be the correct pattern based on the docstring examples and established URL structure.

#### Gaps Identified

1. No documented evidence that current URL format is incorrect
2. Requirements mention "correct URL format and query parameters" but current format appears valid
3. May need verification against actual Quilt catalog behavior across versions
4. Test coverage for upload URL generation exists but integration testing may be needed

#### Open Questions

1. What is the exact expected URL format for package revision?
2. Are there version-specific differences in Quilt catalog URL patterns?
3. Has the current URL format been tested against production catalogs?
4. Are there additional query parameters required for specific catalog versions?

### 2.3 US-3: Clear Package Navigation

#### Current State

**Button Creation (Lines 92-114 in canvas_blocks.py)**:
```python
def create_main_navigation_buttons(entry_id: str) -> List:
    """Create main view navigation buttons (Browse Files, Update Package).

    Args:
        entry_id: Entry identifier for button IDs

    Returns:
        List containing section with navigation buttons
    """
    buttons = [
        create_button(
            button_id=f"browse-files-{entry_id}-p0-s15",
            text="Browse Files",
            enabled=True,
        ),
        create_button(
            button_id=f"update-package-{entry_id}",
            text="Update Package",
            enabled=True,
        ),
    ]

    return [create_section("button-section-main", buttons)]
```

**Test Coverage (Line 149 in test_canvas_browser.py)**:
```python
assert buttons[0].text == "Browse Files"
```

**Handler Routing (Line 332 in app.py)**:
```python
"""Handle Browse Files button click."""
```

#### Gaps Identified

1. Button text "Browse Files" is hard-coded in one location
2. Test assertions explicitly verify "Browse Files" text
3. Docstring describes functionality as "Browse Files"
4. No configuration or constant for button labels

#### Impact Assessment

This is a straightforward text change with minimal complexity:
- Single source of truth for button text
- Tests need to be updated to match new text
- Docstrings should be updated for consistency
- No functional logic changes required

### 2.4 US-4: Clickable URLs in Documentation

#### Current State

**README Generation (Lines 607-656 in entry_packager.py)**:
```python
readme_content = f"""{title}

## Overview
This package contains data exported from Benchling entry `{display_id}`.
"""

if web_url:
    readme_content += f"\n**View in Benchling**: {web_url}\n"
```

**Canvas Formatting (Line 27 in canvas_formatting.py)**:
```python
* {display_id}: [{package_name}]({catalog_url}) [[🔄 sync]]({sync_url}) [[⬆️ upload]]({upload_url})
```

#### Analysis

1. **Canvas UI**: Already uses proper Markdown link syntax `[text](url)`
2. **README.md**: Uses plain text URLs instead of Markdown links
3. **Inconsistency**: Canvas and README use different link formatting approaches

#### Gaps Identified

1. README web_url is displayed as plain text, not a clickable link
2. No consistent pattern for URL presentation in documentation
3. Missing descriptive link text for external URLs
4. Other URLs in README (if any) may also need linkification

#### Pattern Established

The Canvas formatting module demonstrates the correct pattern:
```python
[{package_name}]({catalog_url})
```

### 2.5 US-5: Indexed File Arrays in Metadata

#### Current State

**File Metadata Structure (Lines 471-477 in entry_packager.py)**:
```python
uploaded_files.append(
    {
        "filename": file_info.filename,
        "s3_key": s3_key,
        "size": len(file_content),
    }
)
```

**Entry.json Structure (Lines 573-587 in entry_packager.py)**:
```python
entry_json = {
    "package_name": package_name,
    "entry_id": entry_id,
    "display_id": display_id,
    "name": name,
    "web_url": web_url,
    "creator": creator_str,
    "authors": authors_list,
    "created_at": created_at_str,
    "modified_at": modified_at_str,
    "export_timestamp": timestamp,
    "benchling_base_url": base_url,
    "webhook_data": webhook_data,
    "files": uploaded_files,  # Array of file objects
}
```

#### Analysis

Current structure stores files as an array without explicit indices:
```json
{
  "files": [
    {"filename": "file1.txt", "s3_key": "...", "size": 100},
    {"filename": "file2.txt", "s3_key": "...", "size": 200}
  ]
}
```

#### Gaps Identified

1. No explicit index field in file metadata objects
2. Array position must be inferred from iteration order
3. Correlating metadata with specific files requires manual counting
4. No established pattern for indexed arrays in codebase

#### Enhancement Opportunity

Array indices can be added during file processing without changing the array structure, maintaining some backward compatibility while enhancing usability.

### 2.6 US-6: Dictionary-Based File Metadata

#### Current State

**Files Field Structure** (Line 586 in entry_packager.py):
```python
"files": uploaded_files,  # List[Dict[str, Any]]
```

The `uploaded_files` list is constructed in the `_process_export` method (lines 471-477) as an array of dictionaries.

#### Analysis

Current array-based approach:
- **Pros**: Preserves file ordering, simple iteration, familiar pattern
- **Cons**: Requires iteration to find specific file, O(n) lookup complexity, verbose for programmatic access

Dictionary-based approach:
- **Pros**: O(1) file lookup, more intuitive for developers, clearer intent
- **Cons**: Loses ordering (unless OrderedDict/Python 3.7+), structural breaking change

#### Gaps Identified

1. No dictionary-based access pattern exists in current codebase
2. File lookup requires full array iteration
3. No helper methods for file metadata access
4. Potential breaking change for consumers of entry.json

#### Migration Considerations

1. **Breaking Change**: This is a structural change to the metadata format
2. **Consumer Impact**: Any code parsing entry.json will need updates
3. **Version Strategy**: May need versioning or dual format support
4. **Ordering Preservation**: Python 3.7+ dicts maintain insertion order

### 2.7 US-7: Catalog-Aligned Package Identifiers

#### Current State

**Manifest Generation (Lines 13-29 in manifest.ts)**:
```typescript
const manifest = `manifestVersion: 1
info:
  name: Quilt Integration
  description: Package Benchling notebook entries as Quilt data packages
  version: ${pkg.version}
features:
  - name: Quilt Package
    id: quilt_entry
    type: CANVAS
subscriptions:
  deliveryMethod: WEBHOOK
  messages:
    - type: v2.canvas.userInteracted
    - type: v2.canvas.created
    - type: v2.entry.created
    - type: v2.entry.updated.fields
`;
```

**Feature ID** (Line 21):
```typescript
id: quilt_entry
```

#### Analysis

The current identifier uses underscore separator (`quilt_entry`) while DNS conventions and Quilt catalog standards typically use hyphens (`quilt-integration`).

#### Gaps Identified

1. Feature ID uses underscores instead of hyphens
2. No documentation of naming convention rationale
3. Inconsistent with typical DNS and URL slug conventions
4. May affect catalog integration or package discovery

#### Constraints

1. Changing feature ID may impact existing app installations
2. Benchling app manifest validation may have specific rules
3. Feature ID appears in internal tracking and references
4. Migration path for existing installations needs consideration

## 3. Code Idioms and Conventions

### 3.1 Established Patterns

1. **Configuration Management**
   - Environment variables via `os.getenv()` with defaults
   - Dataclass-based config with validation in `__post_init__`
   - Centralized configuration in `config.py`

2. **Error Handling**
   - Custom exceptions for specific failure modes (e.g., `EntryValidationError`, `BenchlingAPIError`)
   - Structured logging with `structlog`
   - Retry decorators for external API calls (`@REST_API_RETRY`, `@LAMBDA_INVOKE_RETRY`)

3. **Testing Approach**
   - Pytest with fixtures for reusable components
   - Mock-based testing for external dependencies
   - Markers for test categories (`@pytest.mark.local`)
   - TDD methodology emphasized in test files

4. **Markdown Generation**
   - Template strings with f-string formatting
   - Separated formatting functions in `canvas_formatting.py`
   - Consistent use of Markdown link syntax in Canvas UI

5. **URL Generation**
   - Property-based URL generation in Package class
   - URL encoding with `urllib.parse.quote`
   - Centralized URL logic in `packages.py`

6. **Type Hints**
   - Comprehensive type hints throughout codebase
   - Return type annotations for public methods
   - Dict and List annotations with element types

7. **Documentation**
   - Docstrings with Args, Returns, Raises sections
   - Example usage in docstrings
   - Module-level docstrings explaining responsibilities

### 3.2 Architecture Principles

1. **Separation of Concerns**
   - Canvas UI layer separate from business logic
   - Package operations delegated to specialized services
   - Clear module boundaries and responsibilities

2. **Dependency Injection**
   - Optional service injection with default fallbacks
   - Testability through injectable dependencies
   - Configuration passed to constructors

3. **Immutability Preferences**
   - Dataclass config objects
   - Property-based computed values
   - Minimal state mutation

4. **Fail-Fast Validation**
   - Input validation at boundaries
   - Early return for error conditions
   - Explicit error messages with context

## 4. Technical Constraints and Limitations

### 4.1 External API Constraints

1. **Benchling SDK**
   - Display ID may not be in webhook payload (requires API fetch)
   - Entry data structure dictated by Benchling API
   - Rate limits on API calls
   - OAuth token refresh requirements

2. **Quilt Catalog**
   - URL format variations across catalog versions
   - Catalog URL structure affects package navigation
   - Athena database query patterns for package search
   - S3 key structure impacts package organization

3. **AWS Services**
   - S3 naming conventions and restrictions
   - SQS message format requirements
   - Athena query performance considerations
   - Region-specific service availability

### 4.2 System Design Constraints

1. **Backward Compatibility**
   - Existing packages must remain accessible
   - Metadata format changes affect existing consumers
   - URL changes may break saved links
   - Package naming affects S3 key structure

2. **Performance Requirements**
   - Canvas updates must be responsive (<3s)
   - Webhook processing must be fast (return <10s)
   - Athena queries have timeout limits
   - Large file processing in background threads

3. **Testing Limitations**
   - Some tests require AWS access
   - Integration testing requires live Benchling tenant
   - Mock-based testing may not catch integration issues
   - Local development uses mocked AWS services

## 5. Technical Debt Assessment

### 5.1 Current Technical Debt

1. **Inconsistent Display ID Usage**
   - Display ID fetched but not prominently used
   - Multiple code paths for ID extraction
   - No consistent pattern across UI touchpoints

2. **URL Format Validation**
   - Limited integration testing for URL correctness
   - Assumptions about catalog URL structure not validated
   - Version-specific behavior not documented

3. **Metadata Structure Evolution**
   - No versioning for metadata formats
   - No migration strategy for format changes
   - Consumers may depend on undocumented structure

4. **Documentation Gaps**
   - URL format requirements not fully documented
   - Naming conventions lack rationale
   - Integration patterns not captured

### 5.2 Refactoring Opportunities

1. **Centralize Display ID Logic**
   - Create helper methods for consistent Display ID formatting
   - Establish primary/secondary identifier patterns
   - Document Display ID availability guarantees

2. **URL Generation Testing**
   - Add integration tests for URL correctness
   - Validate URLs against actual catalog behavior
   - Document catalog version requirements

3. **Metadata Schema Definition**
   - Define explicit schema for entry.json
   - Add schema version field
   - Create migration utilities

4. **Configuration Documentation**
   - Document naming conventions
   - Clarify DNS alignment requirements
   - Provide migration guides

## 6. Gap Analysis: Current vs Requirements

### 6.1 Display ID Prominence (US-1)

**Current**: Display ID stored but not featured
**Required**: Display ID as primary identifier
**Gap**: Canvas UI, README, and package names need updates
**Complexity**: Medium (multiple touchpoints, backward compatibility)

### 6.2 Package Revision URLs (US-2)

**Current**: Uses `?action=revisePackage`
**Required**: Correct URL format validated
**Gap**: Need verification of current implementation
**Complexity**: Low (may be already correct, needs testing)

### 6.3 Navigation Button Text (US-3)

**Current**: "Browse Files" hard-coded
**Required**: "Browse Package" as label
**Gap**: Single text change with test updates
**Complexity**: Low (simple string replacement)

### 6.4 Clickable URLs (US-4)

**Current**: README uses plain text URLs
**Required**: Markdown link format
**Gap**: README generation needs linkification
**Complexity**: Low (apply existing Canvas pattern)

### 6.5 Indexed File Arrays (US-5)

**Current**: Arrays without explicit indices
**Required**: Index field in each file object
**Gap**: Add index field during file processing
**Complexity**: Low (additive, backward compatible)

### 6.6 Dictionary File Metadata (US-6)

**Current**: Array-based file storage
**Required**: Dictionary with filename keys
**Gap**: Structural change to metadata format
**Complexity**: High (breaking change, migration needed)

### 6.7 Catalog-Aligned Identifiers (US-7)

**Current**: Underscores in feature ID
**Required**: Hyphens for DNS alignment
**Gap**: Manifest generation update
**Complexity**: Medium (existing installations, validation rules)

## 7. Architectural Challenges

### 7.1 Display ID Availability

**Challenge**: Display ID not always available in webhook payload

**Implications**:
- Requires API call to fetch Display ID
- Adds latency to Canvas operations
- Potential for API failures
- Caching considerations

**Current Mitigation**:
- Entry fetching already implemented
- Display ID accessed via `self.entry.display_id`
- Caching at canvas manager level

### 7.2 Package Name Changes

**Challenge**: Changing package naming affects S3 keys and references

**Implications**:
- Existing packages use Entry ID in names
- Changing naming breaks existing package references
- S3 keys are immutable after creation
- Quilt package history tied to package name

**Considerations**:
- May need to support both naming schemes
- Display ID uniqueness within tenant
- Migration strategy for existing packages
- Impact on linked packages and searches

### 7.3 Metadata Format Evolution

**Challenge**: Changing metadata structure affects consumers

**Implications**:
- Breaking changes require migration
- Unknown consumers of entry.json format
- Backward compatibility constraints
- Testing migration scenarios

**Strategies**:
- Additive changes (indices) are safer
- Structural changes (dict vs array) need versioning
- Dual format support during transition
- Schema documentation and validation

### 7.4 URL Format Validation

**Challenge**: Multiple Quilt catalog versions with potentially different URL patterns

**Implications**:
- Current URL format may not work everywhere
- Integration testing requires multiple environments
- Version detection or configuration needed
- Documentation of supported versions

**Current State**:
- URL patterns based on examples in code
- No runtime validation of URL correctness
- Catalog version not tracked or checked

## 8. Design Considerations

### 8.1 Display ID Presentation Strategy

**Options**:
1. Display ID only (Entry ID in metadata)
2. Display ID prominent, Entry ID secondary
3. Configurable presentation format

**Recommendation**: Option 2 balances user needs with technical requirements

### 8.2 Metadata Structure Migration

**Options**:
1. Breaking change (array → dict)
2. Dual format (both array and dict)
3. Versioned metadata format

**Recommendation**: Assess consumer impact before deciding

### 8.3 Package Naming Strategy

**Options**:
1. Keep Entry ID naming (no change)
2. Switch to Display ID naming (breaking)
3. Support both naming schemes

**Recommendation**: Requires investigation of Display ID uniqueness guarantees

### 8.4 Testing Strategy

**Priorities**:
1. URL format validation across catalog versions
2. Metadata structure backward compatibility
3. Display ID availability and fallback scenarios
4. Canvas UI responsiveness with API calls

## 9. Dependencies and Integration Points

### 9.1 External Dependencies

1. **Benchling SDK** (`benchling_sdk`)
   - Entry fetching for Display ID
   - Canvas update operations
   - OAuth token management

2. **Benchling API Client** (`benchling_api_client`)
   - UI block type definitions
   - Canvas block structures

3. **AWS SDKs** (`boto3`)
   - S3 operations for package storage
   - SQS for package creation queue
   - Athena for package queries

4. **Quilt Catalog**
   - Package browsing interface
   - URL pattern requirements
   - Revision/upload operations

### 9.2 Internal Dependencies

1. **Canvas Manager** depends on:
   - Package Query (for linked packages)
   - Package File Fetcher (for file lists)
   - Package (for URL generation)
   - Payload (for entry ID extraction)

2. **Entry Packager** depends on:
   - Benchling SDK (for export operations)
   - Config (for S3/SQS settings)
   - Payload (for webhook data)

3. **Package Query** depends on:
   - Athena client (for database queries)
   - Package class (for result instances)

## 10. Risk Assessment

### 10.1 High Risk Areas

1. **Package Name Changes**
   - Risk: Breaking existing package references
   - Impact: High (loss of package access)
   - Mitigation: Investigate before implementation

2. **Metadata Format Changes (US-6)**
   - Risk: Breaking consumer code
   - Impact: High (unknown consumers)
   - Mitigation: Versioning and migration strategy

### 10.2 Medium Risk Areas

1. **Display ID Availability**
   - Risk: Display ID not present in all cases
   - Impact: Medium (degraded UX)
   - Mitigation: Fallback to Entry ID

2. **URL Format Verification**
   - Risk: Current URLs don't work in all environments
   - Impact: Medium (broken links)
   - Mitigation: Integration testing

### 10.3 Low Risk Areas

1. **Button Text Changes (US-3)**
   - Risk: Minimal
   - Impact: Low (cosmetic only)
   - Mitigation: Test updates

2. **URL Linkification (US-4)**
   - Risk: Minimal
   - Impact: Low (enhancement only)
   - Mitigation: Standard Markdown syntax

3. **File Array Indices (US-5)**
   - Risk: Low (additive change)
   - Impact: Low (backward compatible)
   - Mitigation: None required

## 11. Summary of Challenges

### 11.1 Critical Challenges

1. **Display ID as Primary Identifier**: Requires changes across Canvas UI, README generation, and potentially package naming (high complexity, backward compatibility concerns)

2. **Dictionary-Based File Metadata**: Breaking change to metadata structure with unknown consumer impact (high risk, requires migration strategy)

3. **Package Naming Migration**: Display ID in package names affects S3 keys and existing references (high risk, requires investigation)

### 11.2 Moderate Challenges

1. **URL Format Verification**: Need to validate current URL patterns work across catalog versions (medium complexity, integration testing needed)

2. **Catalog-Aligned Identifiers**: Feature ID change may affect existing installations (medium risk, migration considerations)

### 11.3 Minor Challenges

1. **Button Text Update**: Simple string replacement with test updates (low complexity)

2. **URL Linkification**: Apply established Markdown pattern to README (low complexity)

3. **File Array Indices**: Additive metadata enhancement (low complexity, low risk)

## 12. Next Steps for Specifications

The specifications document (03-specifications.md) should address:

1. **Display ID Strategy**
   - Define Display ID presentation hierarchy
   - Specify fallback behavior when Display ID unavailable
   - Determine if package naming should change

2. **Metadata Schema**
   - Define target metadata structure (array vs dict)
   - Specify versioning approach
   - Plan migration strategy

3. **URL Validation Requirements**
   - Document required URL format for each catalog version
   - Define integration testing strategy
   - Specify error handling for invalid URLs

4. **Backward Compatibility**
   - Define what must remain compatible
   - Specify acceptable breaking changes
   - Plan migration path for existing packages

5. **Testing Strategy**
   - Define test coverage requirements
   - Specify integration test scenarios
   - Plan for manual validation steps

6. **Success Metrics**
   - Define measurable outcomes for each user story
   - Specify acceptance criteria validation approach
   - Plan for user validation and feedback
