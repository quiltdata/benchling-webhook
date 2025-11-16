# Phase 1 Episodes: Atomic Change Units

## GitHub Issue Reference

**Issue**: #141 - UX improvements
**Phase**: Phase 1 - All 7 User Stories (Single-Phase Implementation)
**Methodology**: I RASP DECO - Episodes (E)
**Date**: 2025-10-30
**Design Document**: [05-phase1-design.md](./05-phase1-design.md)

## 1. Overview

This document defines atomic, testable change units for implementing Phase 1. Each episode represents a single logical commit that maintains the codebase in a working state and can be tested independently.

### Episode Structure

Each episode follows this format:

- **ID**: Unique identifier (e.g., E1.1)
- **Title**: Concise description of the change
- **User Story**: Links to specific US-1 through US-7
- **Type**: Test | Implementation | Refactor
- **Dependencies**: Prerequisites that must be completed first
- **TDD Cycle**: Red → Green → Refactor steps
- **Success Criteria**: Testable conditions for completion
- **Estimated Complexity**: S (Simple) | M (Medium) | L (Large)

### Sequencing Principles

1. **Test-First**: Write failing tests before implementation
2. **Incremental**: Each episode builds on previous work
3. **Atomic**: Single commit per episode
4. **Testable**: Can verify correctness at each step
5. **Reversible**: Can be rolled back without breaking the build

---

## 2. Episode Definitions

### Group A: Foundation and Test Infrastructure

#### Episode E1.1: Add Display ID Prominence Tests

**User Story**: US-1 (Display ID Prominence)
**Type**: Test
**Dependencies**: None
**Complexity**: M

**Description**: Create comprehensive tests for Display ID prominence in Canvas headers and README files. These tests will initially fail (Red phase) and guide implementation.

**TDD Cycle**:

1. **RED**: Write failing tests
   - Test `format_package_header()` expects Display ID as H2 heading
   - Test package name appears with "**Package**:" label
   - Test action links have descriptive text
   - Test README title uses Display ID format
   - Test README includes package name context
   - All tests fail with current implementation

2. **GREEN**: Not applicable (test-only episode)

3. **REFACTOR**: Not applicable (test-only episode)

**Files to Create/Modify**:

- `docker/tests/test_canvas_formatting.py` (create if missing)
  - `test_format_package_header_display_id_prominent()`
  - `test_format_package_header_has_package_label()`
  - `test_format_package_header_has_descriptive_links()`
- `docker/tests/test_entry_packager.py`
  - `test_readme_title_uses_display_id_with_name()`
  - `test_readme_title_uses_display_id_without_name()`
  - `test_readme_includes_package_context()`

**Success Criteria**:

- [ ] 6 new tests added
- [ ] All tests fail with current implementation
- [ ] Tests clearly define expected behavior
- [ ] Tests follow pytest conventions
- [ ] Test coverage report shows new test lines

**Commit Message**:

```
test(us-1): add Display ID prominence tests

Add failing tests for Display ID prominence in Canvas headers and README:
- Canvas headers should use Display ID as primary heading
- Package name should have clear label
- Action links should have descriptive text
- README title should feature Display ID
- README should include package context

Tests intentionally fail to drive TDD implementation.

Addresses #141 (US-1)
```

---

#### Episode E1.2: Implement Display ID in Canvas Headers

**User Story**: US-1 (Display ID Prominence)
**Type**: Implementation
**Dependencies**: E1.1
**Complexity**: S

**Description**: Modify `format_package_header()` to elevate Display ID as primary identifier and restructure action links.

**TDD Cycle**:

1. **RED**: Tests from E1.1 fail

2. **GREEN**: Implement minimal changes to pass tests
   - Modify `/Users/ernest/GitHub/benchling-webhook/docker/src/canvas_formatting.py`
   - Line 12-28: Update `format_package_header()` function
   - Change H2 heading from `package_name` to `display_id`
   - Add "**Package**:" label for package name
   - Consolidate actions into descriptive links
   - Update docstring with new format

3. **REFACTOR**: Clean up implementation
   - Ensure consistent formatting
   - Verify link text is user-friendly
   - Validate docstring example matches output

**Files to Modify**:

- `docker/src/canvas_formatting.py`
  - Function: `format_package_header()` (lines 12-28)

**Implementation Details**:

```python
def format_package_header(package_name: str, display_id: str, catalog_url: str, sync_url: str, upload_url: str) -> str:
    """Format primary package header with action links.

    Args:
        package_name: Name of the package (e.g., "benchling/etr_123")
        display_id: Entry display ID (e.g., "EXP00001234") - primary identifier
        catalog_url: URL to catalog view
        sync_url: URL for sync action
        upload_url: URL for upload action

    Returns:
        Formatted markdown string with Display ID as primary heading

    Example:
        ## EXP00001234

        **Package**: [benchling/etr_123](https://catalog.../packages/benchling/etr_123)

        **Actions**: [Browse in catalog](url) | [Sync](url) | [Add files](url)
    """
    return f"""## {display_id}

**Package**: [{package_name}]({catalog_url})

**Actions**: [Browse in catalog]({catalog_url}) | [🔄 Sync]({sync_url}) | [⬆️ Add files]({upload_url})
"""
```

**Success Criteria**:

- [ ] All E1.1 Canvas header tests pass
- [ ] Display ID is H2 heading
- [ ] Package name has clear label
- [ ] Actions are descriptive links
- [ ] Docstring updated and accurate
- [ ] No regressions in existing Canvas tests

**Commit Message**:

```
feat(us-1): elevate Display ID in Canvas headers

Update format_package_header() to prominently feature Display ID:
- Display ID now appears as primary H2 heading
- Package name moved to secondary position with "Package:" label
- Action links consolidated with descriptive text
- Improved user readability and clarity

All tests passing. Addresses #141 (US-1)
```

---

#### Episode E1.3: Implement Display ID in README Files

**User Story**: US-1 (Display ID Prominence)
**Type**: Implementation
**Dependencies**: E1.1
**Complexity**: S

**Description**: Modify README generation in `_create_metadata_files()` to use Display ID as primary title.

**TDD Cycle**:

1. **RED**: Tests from E1.1 fail for README

2. **GREEN**: Implement README title changes
   - Modify `/Users/ernest/GitHub/benchling-webhook/docker/src/entry_packager.py`
   - Lines 602-614: Update title building logic
   - Display ID becomes primary title
   - Entry name added as subtitle when available
   - Package name provided for context
   - Update docstring to reflect changes

3. **REFACTOR**: Clean up title logic
   - Simplify conditional logic
   - Ensure consistent formatting
   - Validate output examples

**Files to Modify**:

- `docker/src/entry_packager.py`
  - Function: `_create_metadata_files()` (lines 602-614)

**Implementation Details**:

```python
# Build title hierarchy: Display ID > Name > Package
# Display ID is most prominent, entry name if available, package name for context
if name:
    title = f"# {display_id}: {name}"
else:
    title = f"# {display_id}"

readme_content = f"""{title}

**Package**: `{package_name}`

## Overview
This package contains data exported from Benchling entry `{display_id}`.
"""
```

**Success Criteria**:

- [ ] All E1.1 README tests pass
- [ ] Title uses Display ID prominently
- [ ] Entry name incorporated when available
- [ ] Package name provided for context
- [ ] Format is clean and readable
- [ ] No regressions in README generation

**Commit Message**:

```
feat(us-1): use Display ID in README titles

Update _create_metadata_files() to feature Display ID in README:
- Display ID is primary title element
- Entry name included as subtitle when available
- Package name provided for technical context
- Improved user orientation in package documentation

All tests passing. Addresses #141 (US-1)
```

---

### Group B: URL and Navigation Improvements

#### Episode E2.1: Add URL Linkification Tests

**User Story**: US-4 (Clickable URLs in Documentation)
**Type**: Test
**Dependencies**: None
**Complexity**: M

**Description**: Create tests for URL linkification in README files. All URLs should be proper Markdown links with descriptive text.

**TDD Cycle**:

1. **RED**: Write failing tests
   - Test Benchling web URL is linkified
   - Test catalog URL is linkified
   - Test links have descriptive text (not bare URLs)
   - Test plain text URLs are not present
   - All tests fail with current implementation

2. **GREEN**: Not applicable (test-only episode)

3. **REFACTOR**: Not applicable (test-only episode)

**Files to Create/Modify**:

- `docker/tests/test_entry_packager.py`
  - `test_readme_web_url_is_linkified()`
  - `test_readme_catalog_url_is_linkified()`
  - `test_readme_has_no_bare_urls()`
  - `test_readme_links_have_descriptive_text()`

**Success Criteria**:

- [ ] 4 new tests added
- [ ] All tests fail with current implementation
- [ ] Tests verify Markdown link format
- [ ] Tests verify descriptive link text
- [ ] Tests check for absence of bare URLs

**Commit Message**:

```
test(us-4): add URL linkification tests

Add failing tests for clickable URLs in README files:
- Benchling web URLs should be Markdown links
- Catalog URLs should be Markdown links
- Links should have descriptive text
- Bare URLs should not appear in output

Tests intentionally fail to drive TDD implementation.

Addresses #141 (US-4)
```

---

#### Episode E2.2: Implement URL Linkification

**User Story**: US-4 (Clickable URLs in Documentation)
**Type**: Implementation
**Dependencies**: E2.1, E1.3 (README changes)
**Complexity**: S

**Description**: Convert plain text URLs in README to proper Markdown links with descriptive text.

**TDD Cycle**:

1. **RED**: Tests from E2.1 fail

2. **GREEN**: Implement URL linkification
   - Modify `/Users/ernest/GitHub/benchling-webhook/docker/src/entry_packager.py`
   - Line 614: Convert web URL to Markdown link
   - Add catalog URL as Markdown link
   - Use descriptive link text
   - Ensure all URLs are clickable

3. **REFACTOR**: Clean up URL formatting
   - Consolidate link generation logic
   - Ensure consistent descriptive text
   - Validate link format

**Files to Modify**:

- `docker/src/entry_packager.py`
  - Function: `_create_metadata_files()` (lines 614, 637+)

**Implementation Details**:

```python
# Convert Benchling URL to link
if web_url:
    readme_content += f"\n[View entry in Benchling]({web_url})\n"

# Add catalog URL
catalog_base_url = self.config.catalog_base_url
bucket = self.config.s3_bucket_name
catalog_url = f"https://{catalog_base_url}/b/{bucket}/packages/{package_name}"
readme_content += f"\n[Browse package in Quilt catalog]({catalog_url})\n"
```

**Success Criteria**:

- [ ] All E2.1 tests pass
- [ ] Web URLs are Markdown links
- [ ] Catalog URLs are Markdown links
- [ ] Links have descriptive text
- [ ] No bare URLs in output
- [ ] Links are clickable in rendered Markdown

**Commit Message**:

```
feat(us-4): linkify URLs in README files

Convert plain text URLs to clickable Markdown links:
- Benchling web URLs now have descriptive link text
- Catalog URLs added with descriptive text
- All URLs are clickable in rendered documentation
- Improved user experience in package READMEs

All tests passing. Addresses #141 (US-4)
```

---

#### Episode E2.3: Add Navigation Button Label Tests

**User Story**: US-3 (Browse Package Button Label)
**Type**: Test
**Dependencies**: None
**Complexity**: S

**Description**: Create tests for updated button label "Browse Package" instead of "Browse Files".

**TDD Cycle**:

1. **RED**: Write failing tests
   - Test button text is "Browse Package"
   - Test button ID remains unchanged (backward compatibility)
   - Test fails with current "Browse Files" label

2. **GREEN**: Not applicable (test-only episode)

3. **REFACTOR**: Not applicable (test-only episode)

**Files to Modify**:

- `docker/tests/test_canvas_blocks.py`
  - `test_main_navigation_buttons_browse_package_label()`
  - Update existing test assertions

**Success Criteria**:

- [ ] 1 new test added
- [ ] Test fails with current "Browse Files" label
- [ ] Test verifies button ID unchanged
- [ ] Test follows existing test patterns

**Commit Message**:

```
test(us-3): add Browse Package button label test

Add failing test for updated navigation button label:
- Button text should be "Browse Package" not "Browse Files"
- Button ID should remain unchanged for routing compatibility

Test intentionally fails to drive TDD implementation.

Addresses #141 (US-3)
```

---

#### Episode E2.4: Implement Navigation Button Label Update

**User Story**: US-3 (Browse Package Button Label)
**Type**: Implementation
**Dependencies**: E2.3
**Complexity**: S

**Description**: Update button text from "Browse Files" to "Browse Package" while preserving button ID.

**TDD Cycle**:

1. **RED**: Tests from E2.3 fail

2. **GREEN**: Update button label
   - Modify `/Users/ernest/GitHub/benchling-webhook/docker/src/canvas_blocks.py`
   - Line 272: Change button text to "Browse Package"
   - Keep button ID unchanged
   - Update docstring

3. **REFACTOR**: Clean up button creation
   - Verify button properties correct
   - Ensure consistent terminology

**Files to Modify**:

- `docker/src/canvas_blocks.py`
  - Function: `create_main_navigation_buttons()` (lines 92-114)

**Implementation Details**:

```python
def create_main_navigation_buttons(entry_id: str) -> List:
    """Create main view navigation buttons (Browse Package, Update Package).

    Args:
        entry_id: Entry identifier for button IDs

    Returns:
        List containing section with navigation buttons
    """
    buttons = [
        create_button(
            button_id=f"browse-files-{entry_id}-p0-s15",  # Keep ID for backward compatibility
            text="Browse Package",  # Updated label
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

**Success Criteria**:

- [ ] All E2.3 tests pass
- [ ] Button text is "Browse Package"
- [ ] Button ID unchanged
- [ ] Docstring updated
- [ ] No regressions in button functionality

**Commit Message**:

```
feat(us-3): update navigation button label to "Browse Package"

Update button text for clearer terminology:
- Changed "Browse Files" to "Browse Package"
- Button ID preserved for routing compatibility
- Improved user understanding of button action

All tests passing. Addresses #141 (US-3)
```

---

#### Episode E2.5: Verify Package Revision URLs

**User Story**: US-2 (Fix Package Revision URLs)
**Type**: Test + Investigation
**Dependencies**: None
**Complexity**: M

**Description**: Investigate and verify current upload URL format works correctly. Create tests to validate URL structure.

**TDD Cycle**:

1. **RED**: Write URL validation tests
   - Test URL contains correct action parameter
   - Test URL structure matches catalog conventions
   - Test URL resolves correctly

2. **GREEN**: Verify current implementation
   - If URLs work: Tests pass, no changes needed
   - If URLs broken: Implement fix in next episode

3. **REFACTOR**: Document findings
   - Add comments explaining URL format
   - Document any catalog-specific requirements

**Files to Create/Modify**:

- `docker/tests/test_packages.py`
  - `test_upload_url_format()`
  - `test_upload_url_has_action_parameter()`
  - `test_upload_url_structure()`

**Manual Verification**:

- [ ] Generate upload URL in Canvas
- [ ] Click URL in test Benchling environment
- [ ] Verify it opens package revision interface
- [ ] Test across catalog environments (stable/nightly)
- [ ] Document actual vs expected behavior

**Success Criteria**:

- [ ] 3 validation tests added
- [ ] Manual testing completed
- [ ] URL behavior documented
- [ ] Decision made: working or needs fix
- [ ] If working: tests pass, episode closes
- [ ] If broken: issue documented for E2.6

**Commit Message** (if URLs work):

```
test(us-2): verify package revision URL format

Add tests validating upload URL structure:
- URL format verified against Quilt catalog
- Action parameter confirmed correct
- Manual testing shows URLs work as expected

Current implementation is correct. Addresses #141 (US-2)
```

**Commit Message** (if URLs need fix):

```
test(us-2): identify package revision URL issue

Add tests documenting correct upload URL format:
- Tests define expected URL structure
- Manual testing identified incorrect action parameter
- Document correct format for implementation

Tests intentionally fail. Addresses #141 (US-2)
```

---

#### Episode E2.6: Fix Package Revision URLs (Conditional)

**User Story**: US-2 (Fix Package Revision URLs)
**Type**: Implementation
**Dependencies**: E2.5
**Complexity**: S
**Conditional**: Only if E2.5 identifies URL issues

**Description**: Fix upload URL generation if E2.5 testing reveals issues.

**TDD Cycle**:

1. **RED**: Tests from E2.5 fail

2. **GREEN**: Fix URL generation
   - Modify `/Users/ernest/GitHub/benchling-webhook/docker/src/packages.py`
   - Line 114-123: Update `upload_url` property
   - Correct action parameter based on E2.5 findings
   - Update docstring with correct format

3. **REFACTOR**: Clean up URL generation
   - Consolidate URL building logic
   - Add validation for URL components

**Files to Modify**:

- `docker/src/packages.py`
  - Property: `upload_url` (lines 114-123)

**Implementation Details** (example if action parameter wrong):

```python
@property
def upload_url(self) -> str:
    """Generate upload/revise package URL for adding files.

    Returns:
        Quilt catalog URL with correct action parameter

    Example:
        'https://nightly.quilttest.com/b/my-bucket/packages/benchling/etr_123?action=addFiles'
    """
    # Corrected action parameter based on catalog requirements
    return f"{self.catalog_url}?action=addFiles"
```

**Success Criteria**:

- [ ] All E2.5 tests pass
- [ ] Upload URLs work in manual testing
- [ ] URL structure matches catalog requirements
- [ ] Docstring updated with correct example
- [ ] No regressions in URL generation

**Commit Message**:

```
fix(us-2): correct package revision URL action parameter

Update upload_url property to use correct action parameter:
- Changed action from "revisePackage" to "addFiles"
- URLs now correctly open revision interface
- Verified across catalog environments

All tests passing. Addresses #141 (US-2)
```

---

### Group C: Metadata Structure Improvements

#### Episode E3.1: Add File Index Tests

**User Story**: US-5 (Indexed File Arrays)
**Type**: Test
**Dependencies**: None
**Complexity**: M

**Description**: Create tests verifying file metadata includes explicit index field for position tracking.

**TDD Cycle**:

1. **RED**: Write failing tests
   - Test uploaded files include index field
   - Test indices are zero-based and sequential
   - Test indices match array position
   - Test metadata files include index field
   - All tests fail with current implementation

2. **GREEN**: Not applicable (test-only episode)

3. **REFACTOR**: Not applicable (test-only episode)

**Files to Create/Modify**:

- `docker/tests/test_entry_packager.py`
  - `test_uploaded_files_include_indices()`
  - `test_file_indices_are_sequential()`
  - `test_file_indices_are_zero_based()`
  - `test_metadata_files_include_indices()`

**Success Criteria**:

- [ ] 4 new tests added
- [ ] All tests fail with current implementation
- [ ] Tests verify index field presence
- [ ] Tests verify index correctness
- [ ] Tests cover both data and metadata files

**Commit Message**:

```
test(us-5): add file index tests

Add failing tests for explicit file indices:
- Uploaded files should include index field
- Indices should be zero-based and sequential
- Indices should match array position
- Metadata files should include indices

Tests intentionally fail to drive TDD implementation.

Addresses #141 (US-5)
```

---

#### Episode E3.2: Implement File Array Indices

**User Story**: US-5 (Indexed File Arrays)
**Type**: Implementation
**Dependencies**: E3.1
**Complexity**: S

**Description**: Add explicit zero-based index field to all file metadata entries.

**TDD Cycle**:

1. **RED**: Tests from E3.1 fail

2. **GREEN**: Add index field
   - Modify `/Users/ernest/GitHub/benchling-webhook/docker/src/entry_packager.py`
   - Lines 471-477: Add index to data file entries
   - Lines 504-510: Add index to metadata file entries
   - Index value is current array length (zero-based)

3. **REFACTOR**: Clean up index assignment
   - Ensure indices are sequential
   - Verify index placement in dictionary
   - Validate index values

**Files to Modify**:

- `docker/src/entry_packager.py`
  - Function: `_process_export()` (lines 471-477)
  - Function: `_create_metadata_files()` (lines 504-510)

**Implementation Details**:

```python
# In _process_export() for data files
uploaded_files.append(
    {
        "index": len(uploaded_files),  # Zero-based index
        "filename": file_info.filename,
        "s3_key": s3_key,
        "size": len(file_content),
    }
)

# In _create_metadata_files() for metadata files
uploaded_files.append(
    {
        "index": len(uploaded_files),  # Zero-based index
        "filename": filename,
        "s3_key": s3_key,
        "size": len(body),
    }
)
```

**Success Criteria**:

- [ ] All E3.1 tests pass
- [ ] All file entries include index field
- [ ] Indices are zero-based (start at 0)
- [ ] Indices are sequential (no gaps)
- [ ] Indices match array position
- [ ] No regressions in file processing

**Commit Message**:

```
feat(us-5): add explicit indices to file arrays

Add zero-based index field to file metadata:
- Data files include index field
- Metadata files include index field
- Indices are sequential and match array position
- Improved file position tracking and correlation

All tests passing. Addresses #141 (US-5)
```

---

#### Episode E3.3: Add Dictionary Metadata Tests

**User Story**: US-6 (Dictionary-Based File Metadata)
**Type**: Test
**Dependencies**: E3.2 (requires indexed files)
**Complexity**: L

**Description**: Create comprehensive tests for dictionary-based file metadata structure with version identifier.

**TDD Cycle**:

1. **RED**: Write failing tests
   - Test entry.json includes metadata_version field
   - Test files is dictionary not array
   - Test dictionary keys are filenames
   - Test dictionary values have file metadata
   - Test indices preserved in dictionary
   - Test dictionary maintains insertion order
   - All tests fail with current array structure

2. **GREEN**: Not applicable (test-only episode)

3. **REFACTOR**: Not applicable (test-only episode)

**Files to Create/Modify**:

- `docker/tests/test_entry_packager.py`
  - `test_entry_json_has_metadata_version()`
  - `test_entry_json_files_as_dictionary()`
  - `test_files_dictionary_keys_are_filenames()`
  - `test_files_dictionary_values_have_metadata()`
  - `test_files_dictionary_preserves_indices()`
  - `test_files_dictionary_preserves_order()`

**Success Criteria**:

- [ ] 6 new tests added
- [ ] All tests fail with current array structure
- [ ] Tests verify version identifier
- [ ] Tests verify dictionary structure
- [ ] Tests verify ordering guarantees
- [ ] Tests cover edge cases (empty files, many files)

**Commit Message**:

```
test(us-6): add dictionary metadata tests

Add failing tests for dictionary-based file metadata:
- entry.json should have metadata_version field
- files should be dictionary with filename keys
- Dictionary should preserve indices
- Dictionary should maintain insertion order
- Breaking change clearly defined by tests

Tests intentionally fail to drive TDD implementation.

Addresses #141 (US-6)
```

---

#### Episode E3.4: Implement Dictionary-Based File Metadata

**User Story**: US-6 (Dictionary-Based File Metadata)
**Type**: Implementation
**Dependencies**: E3.3
**Complexity**: M

**Description**: Convert files array to dictionary structure with filename keys. Add metadata version identifier.

**TDD Cycle**:

1. **RED**: Tests from E3.3 fail

2. **GREEN**: Implement dictionary conversion
   - Modify `/Users/ernest/GitHub/benchling-webhook/docker/src/entry_packager.py`
   - Lines 586-520: Convert files array to dictionary
   - Add metadata_version field
   - Preserve index in dictionary values
   - Maintain insertion order (Python 3.7+)

3. **REFACTOR**: Clean up conversion logic
   - Extract dictionary conversion to helper function
   - Add validation for filename uniqueness
   - Document breaking change in code

**Files to Modify**:

- `docker/src/entry_packager.py`
  - Function: `_create_metadata_files()` (lines 586-520)

**Implementation Details**:

```python
# Convert files array to dictionary with filename as key
files_dict = {}
for file_info in uploaded_files:
    filename = file_info["filename"]
    files_dict[filename] = {
        "s3_key": file_info["s3_key"],
        "size": file_info["size"],
        "index": file_info["index"],  # Preserve index for reference
    }

entry_json = {
    "metadata_version": "2.0",  # Version identifier
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
    "files": files_dict,  # Dictionary with filename keys
}
```

**Success Criteria**:

- [ ] All E3.3 tests pass
- [ ] metadata_version is "2.0"
- [ ] files is dictionary not array
- [ ] Dictionary keys are filenames
- [ ] Dictionary values contain metadata
- [ ] Indices preserved
- [ ] Insertion order maintained
- [ ] No regressions in metadata generation

**Commit Message**:

```
feat(us-6): convert file metadata to dictionary structure

BREAKING CHANGE: files field now uses dictionary structure

Convert files array to dictionary with filename keys:
- Add metadata_version: "2.0" identifier
- Dictionary keys are filenames for direct access
- Dictionary values contain s3_key, size, and index
- Python 3.7+ maintains insertion order
- Improved usability for file metadata access

All tests passing. Addresses #141 (US-6)
```

---

### Group D: CLI and Documentation

#### Episode E4.1: Add CLI Identifier Format Tests

**User Story**: US-7 (CLI Identifier Format)
**Type**: Test
**Dependencies**: None
**Complexity**: M

**Description**: Create tests for hyphenated feature ID format in CLI manifest generation.

**TDD Cycle**:

1. **RED**: Write failing tests
   - Test manifest uses hyphenated feature ID
   - Test manifest does not use underscores
   - Test feature ID conforms to DNS conventions
   - Test fails with current underscore format

2. **GREEN**: Not applicable (test-only episode)

3. **REFACTOR**: Not applicable (test-only episode)

**Files to Create**:

- `test/manifest.test.ts` (create new test file)
  - `test generates manifest with hyphenated feature ID`
  - `test feature ID does not contain underscores`
  - `test feature ID conforms to DNS naming conventions`

**Success Criteria**:

- [ ] 3 new tests added
- [ ] All tests fail with current underscore format
- [ ] Tests verify hyphenated format
- [ ] Tests verify DNS conventions
- [ ] Tests use proper TypeScript/Jest patterns

**Commit Message**:

```
test(us-7): add CLI identifier format tests

Add failing tests for hyphenated feature identifiers:
- Feature ID should use hyphens not underscores
- Feature ID should conform to DNS conventions
- Manifest should use "quilt-integration" format

Tests intentionally fail to drive TDD implementation.

Addresses #141 (US-7)
```

---

#### Episode E4.2: Implement CLI Identifier Format

**User Story**: US-7 (CLI Identifier Format)
**Type**: Implementation
**Dependencies**: E4.1
**Complexity**: S

**Description**: Update manifest command to use hyphenated feature ID format aligned with DNS conventions.

**TDD Cycle**:

1. **RED**: Tests from E4.1 fail

2. **GREEN**: Update feature ID
   - Modify `/Users/ernest/GitHub/benchling-webhook/bin/commands/manifest.ts`
   - Line 36: Change feature ID from "quilt_entry" to "quilt-integration"
   - Update any related references

3. **REFACTOR**: Verify manifest format
   - Ensure consistent naming conventions
   - Document ID format requirements
   - Check for other identifiers needing update

**Files to Modify**:

- `bin/commands/manifest.ts`
  - Manifest template string (line 36)

**Implementation Details**:

```typescript
const manifest = `manifestVersion: 1
info:
  name: Quilt Integration
  description: Package Benchling notebook entries as Quilt data packages
  version: ${pkg.version}
features:
  - name: Quilt Package
    id: quilt-integration  # Changed from quilt_entry to use hyphens
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

**Success Criteria**:

- [ ] All E4.1 tests pass
- [ ] Feature ID uses hyphens
- [ ] No underscores in identifiers
- [ ] ID conforms to DNS conventions
- [ ] Manifest validates successfully
- [ ] No regressions in manifest generation

**Manual Verification**:

- [ ] Generate manifest with CLI command
- [ ] Verify manifest validates with Benchling API
- [ ] Test with existing installation (if available)
- [ ] Document any migration requirements

**Commit Message**:

```
feat(us-7): use hyphenated format for CLI identifiers

Update feature ID to align with DNS conventions:
- Changed "quilt_entry" to "quilt-integration"
- Uses hyphens instead of underscores
- Consistent with modern naming standards

Note: May require app re-installation if ID is immutable.

All tests passing. Addresses #141 (US-7)
```

---

#### Episode E4.3: Update CHANGELOG for Breaking Changes

**User Story**: US-6 (Dictionary Metadata), US-7 (CLI Identifiers)
**Type**: Documentation
**Dependencies**: E3.4, E4.2
**Complexity**: M

**Description**: Document breaking changes and provide migration guide in CHANGELOG.

**TDD Cycle**:
Not applicable (documentation episode)

**Files to Modify**:

- `CHANGELOG.md`

**Content Requirements**:

- [ ] Version bump to 1.0.0 documented
- [ ] Breaking changes clearly marked
- [ ] Migration guide for dictionary metadata
- [ ] Migration guide for CLI identifiers
- [ ] All user stories documented
- [ ] Release date and issue reference

**Success Criteria**:

- [ ] CHANGELOG.md updated
- [ ] Breaking changes section clear
- [ ] Migration examples provided
- [ ] Version detection pattern documented
- [ ] All 7 user stories listed
- [ ] Follows Keep a Changelog format

**Commit Message**:

```
docs: add v1.0.0 CHANGELOG with breaking changes

Document breaking changes and improvements:
- US-6: Dictionary-based file metadata (breaking)
- US-7: Hyphenated CLI identifiers (potentially breaking)
- US-1: Display ID prominence (non-breaking)
- US-3: Browse Package label (non-breaking)
- US-4: Linkified URLs (non-breaking)
- US-5: Indexed arrays (non-breaking)
- US-2: Verified revision URLs (non-breaking)

Include migration guide for dictionary metadata format.

Addresses #141
```

---

### Group E: Integration and Validation

#### Episode E5.1: Run Full Test Suite

**User Story**: All (Integration)
**Type**: Test
**Dependencies**: All previous episodes
**Complexity**: M

**Description**: Execute complete test suite to verify all changes integrate correctly and maintain test coverage.

**TDD Cycle**:
Not applicable (validation episode)

**Tasks**:

- [ ] Run pytest with coverage report
- [ ] Verify >= 85% overall coverage
- [ ] Verify >= 90% coverage for modified modules
- [ ] Check for test failures
- [ ] Review coverage gaps
- [ ] Add tests for any uncovered code paths

**Commands**:

```bash
cd docker
pytest --cov=src --cov-report=term-missing --cov-report=html
```

**Success Criteria**:

- [ ] All tests pass (0 failures)
- [ ] Overall coverage >= 85%
- [ ] Modified modules coverage >= 90%
- [ ] No critical coverage gaps
- [ ] Coverage report generated

**Commit Message** (if additional tests needed):

```
test: add coverage for uncovered code paths

Add tests to reach coverage targets:
- Overall coverage: X%
- Modified modules: Y%
- Addressed coverage gaps in [modules]

All tests passing.
```

---

#### Episode E5.2: Integration Testing

**User Story**: All (Integration)
**Type**: Test
**Dependencies**: E5.1
**Complexity**: L

**Description**: Create and run end-to-end integration test validating complete workflow with all UX improvements.

**TDD Cycle**:

1. **RED**: Create integration test (may initially fail)

2. **GREEN**: Fix any integration issues

3. **REFACTOR**: Optimize integration test

**Files to Create**:

- `docker/tests/test_integration_ux.py`
  - `test_complete_package_creation_with_ux_improvements()`

**Test Coverage**:

- [ ] Entry export triggered
- [ ] Display ID captured and used
- [ ] Files include indices
- [ ] entry.json uses dictionary structure
- [ ] entry.json has metadata_version
- [ ] README uses Display ID title
- [ ] README URLs are linkified
- [ ] Canvas header shows Display ID
- [ ] Canvas buttons use correct labels
- [ ] All URLs functional

**Success Criteria**:

- [ ] Integration test implemented
- [ ] Test covers full workflow
- [ ] All components integrate correctly
- [ ] Test can run in CI/CD
- [ ] Test passes locally

**Commit Message**:

```
test: add end-to-end integration test for UX improvements

Create comprehensive integration test validating:
- Complete workflow from webhook to Canvas
- All 7 user stories integrated correctly
- Dictionary metadata structure
- Display ID prominence
- URL linkification
- Navigation labels
- File indices

All tests passing. Addresses #141
```

---

#### Episode E5.3: Type Checking and Linting

**User Story**: All (Quality)
**Type**: Quality Assurance
**Dependencies**: All implementation episodes
**Complexity**: M

**Description**: Run type checker and linter to ensure code quality standards met.

**TDD Cycle**:
Not applicable (quality episode)

**Tasks**:

- [ ] Run mypy type checker
- [ ] Run ruff linter
- [ ] Fix any type errors
- [ ] Fix any linting errors
- [ ] Update type hints if needed
- [ ] Ensure all docstrings present

**Commands**:

```bash
cd docker
mypy src/
ruff check src/
ruff format src/
```

**Success Criteria**:

- [ ] No mypy type errors
- [ ] No ruff linting errors
- [ ] Code formatted consistently
- [ ] All functions have type hints
- [ ] All functions have docstrings

**Commit Message** (if fixes needed):

```
style: fix type hints and linting errors

Address type checking and linting issues:
- Fix type hints in [modules]
- Resolve linting errors in [modules]
- Format code consistently with ruff
- Update docstrings for clarity

All quality checks passing.
```

---

#### Episode E5.4: Manual Validation Checklist

**User Story**: All (Validation)
**Type**: Manual Testing
**Dependencies**: E5.1, E5.2
**Complexity**: L

**Description**: Perform manual validation of all changes in realistic environment.

**TDD Cycle**:
Not applicable (manual validation episode)

**Manual Tests**:

**US-1: Display ID Prominence**

- [ ] Generate new package
- [ ] Verify Canvas shows Display ID as heading
- [ ] Verify package name has label
- [ ] View README in catalog
- [ ] Verify README title uses Display ID

**US-2: Package Revision URLs**

- [ ] Click "Add files" link in Canvas
- [ ] Verify it opens revision interface
- [ ] Test in multiple catalog environments
- [ ] Document any issues

**US-3: Navigation Button**

- [ ] View Canvas in Benchling
- [ ] Verify button says "Browse Package"
- [ ] Click button and verify it works

**US-4: Clickable URLs**

- [ ] View README in catalog
- [ ] Verify URLs are clickable links
- [ ] Click Benchling URL and verify navigation
- [ ] Click catalog URL and verify navigation

**US-5: File Indices**

- [ ] Download entry.json
- [ ] Verify files have index field
- [ ] Verify indices are sequential
- [ ] Verify indices match positions

**US-6: Dictionary Metadata**

- [ ] Download entry.json
- [ ] Verify metadata_version is "2.0"
- [ ] Verify files is dictionary
- [ ] Verify filenames are keys
- [ ] Verify order preserved

**US-7: CLI Identifiers**

- [ ] Generate manifest with CLI
- [ ] Verify feature ID is "quilt-integration"
- [ ] Validate manifest with Benchling
- [ ] Document compatibility

**Success Criteria**:

- [ ] All manual tests completed
- [ ] All manual tests pass
- [ ] Issues documented
- [ ] Screenshots captured
- [ ] Validation report created

**Commit Message**:

```
docs: add manual validation report for UX improvements

Document manual testing results:
- All 7 user stories validated
- Canvas rendering verified
- URL functionality confirmed
- Metadata structure validated
- Ready for deployment

Addresses #141
```

---

## 3. Episode Summary

### Sequencing Overview

```
Foundation (Test Infrastructure)
├── E1.1: Display ID Tests
├── E1.2: Display ID Canvas Implementation
└── E1.3: Display ID README Implementation

Navigation & URLs
├── E2.1: URL Linkification Tests
├── E2.2: URL Linkification Implementation
├── E2.3: Button Label Tests
├── E2.4: Button Label Implementation
├── E2.5: URL Verification (Investigation)
└── E2.6: URL Fix (Conditional)

Metadata Structure
├── E3.1: File Index Tests
├── E3.2: File Index Implementation
├── E3.3: Dictionary Metadata Tests
└── E3.4: Dictionary Metadata Implementation

CLI & Documentation
├── E4.1: CLI Identifier Tests
├── E4.2: CLI Identifier Implementation
└── E4.3: CHANGELOG Update

Integration & Quality
├── E5.1: Full Test Suite
├── E5.2: Integration Testing
├── E5.3: Type Checking & Linting
└── E5.4: Manual Validation
```

### Episode Statistics

- **Total Episodes**: 21 (20 mandatory, 1 conditional)
- **Test Episodes**: 8
- **Implementation Episodes**: 9
- **Quality Episodes**: 3
- **Documentation Episodes**: 1

**Complexity Breakdown**:

- Simple (S): 8 episodes
- Medium (M): 10 episodes
- Large (L): 3 episodes

**Estimated Timeline**:

- Simple episodes: ~1-2 hours each
- Medium episodes: ~2-4 hours each
- Large episodes: ~4-8 hours each
- **Total estimated effort**: 50-70 hours

---

## 4. Dependencies Graph

```
E1.1 (Display ID Tests) → E1.2 (Canvas Implementation)
                        → E1.3 (README Implementation)

E2.1 (URL Tests) + E1.3 → E2.2 (URL Implementation)

E2.3 (Button Tests) → E2.4 (Button Implementation)

E2.5 (URL Verification) → E2.6 (URL Fix, conditional)

E3.1 (Index Tests) → E3.2 (Index Implementation) → E3.3 (Dict Tests) → E3.4 (Dict Implementation)

E4.1 (CLI Tests) → E4.2 (CLI Implementation)

E3.4 + E4.2 → E4.3 (CHANGELOG)

All implementations → E5.1 (Test Suite) → E5.2 (Integration) → E5.3 (Quality) → E5.4 (Validation)
```

---

## 5. TDD Cycle Summary

Each episode follows Test-Driven Development:

1. **RED Phase** (Test Episode)
   - Write comprehensive failing tests
   - Define expected behavior clearly
   - Commit test-only changes

2. **GREEN Phase** (Implementation Episode)
   - Implement minimal code to pass tests
   - Verify all tests pass
   - Commit working implementation

3. **REFACTOR Phase** (Same Episode)
   - Improve code quality
   - Optimize implementation
   - Maintain passing tests
   - Commit refactored code

### Episode Pairing

Test and implementation episodes are paired:

- E1.1 (RED) → E1.2, E1.3 (GREEN + REFACTOR)
- E2.1 (RED) → E2.2 (GREEN + REFACTOR)
- E2.3 (RED) → E2.4 (GREEN + REFACTOR)
- E3.1 (RED) → E3.2 (GREEN + REFACTOR)
- E3.3 (RED) → E3.4 (GREEN + REFACTOR)
- E4.1 (RED) → E4.2 (GREEN + REFACTOR)

---

## 6. Success Criteria Rollup

### All Episodes Complete When

**Code Quality**:

- [ ] All tests pass (pytest + integration tests)
- [ ] Test coverage >= 85% overall
- [ ] Test coverage >= 90% for modified modules
- [ ] No mypy type errors
- [ ] No ruff linting errors
- [ ] All functions have type hints and docstrings

**Feature Completeness**:

- [ ] US-1: Display ID prominent in Canvas and README
- [ ] US-2: Upload URLs verified and functional
- [ ] US-3: Navigation buttons use "Browse Package" label
- [ ] US-4: All URLs linkified in documentation
- [ ] US-5: File metadata includes explicit indices
- [ ] US-6: File metadata uses dictionary structure
- [ ] US-7: CLI uses hyphenated identifiers

**Documentation**:

- [ ] CHANGELOG updated with breaking changes
- [ ] Migration guide provided for dictionary format
- [ ] All docstrings updated
- [ ] Manual validation report completed

**Quality Assurance**:

- [ ] Integration test validates full workflow
- [ ] Manual testing completed successfully
- [ ] No regressions in existing functionality
- [ ] Ready for production deployment

---

## 7. Risk Mitigation per Episode

### High-Risk Episodes

**E3.4: Dictionary Metadata Implementation**

- **Risk**: Breaking change impacts unknown consumers
- **Mitigation**: Version identifier enables format detection
- **Rollback**: Can revert commit if critical issues found
- **Monitoring**: Watch for parsing errors in logs

**E4.2: CLI Identifier Implementation**

- **Risk**: Feature ID change may break existing installations
- **Mitigation**: Manual verification before commit
- **Rollback**: Can revert if Benchling rejects new manifest
- **Documentation**: Migration steps if needed

### Medium-Risk Episodes

**E2.6: URL Fix (Conditional)**

- **Risk**: URL format may vary by catalog environment
- **Mitigation**: E2.5 investigation validates across environments
- **Testing**: Manual validation required

---

## 8. Next Steps

1. **Review this episodes document**: Ensure all episodes are well-defined and sequenced correctly

2. **Create Phase 1 checklist** (`07-phase1-checklist.md`):
   - Convert episodes to actionable checklist
   - Add tracking for each episode
   - Include success criteria per episode

3. **Begin implementation**:
   - Start with E1.1 (Display ID Tests)
   - Follow TDD cycle strictly
   - Commit after each episode
   - Track progress in checklist

4. **Continuous validation**:
   - Run tests after each implementation
   - Monitor coverage after each episode
   - Address issues before moving to next episode

---

**Document Version**: 1.0
**Last Updated**: 2025-10-30
**Status**: Ready for Implementation
**Total Episodes**: 21 (20 mandatory, 1 conditional)
**Estimated Effort**: 50-70 hours
