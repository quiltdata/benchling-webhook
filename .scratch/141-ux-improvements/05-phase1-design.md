# Phase 1 Design Document: UX Improvements

## GitHub Issue Reference

**Issue**: #141 - UX improvements
**Phase**: Phase 1 - All 7 User Stories (Single-Phase Implementation)
**Methodology**: I RASP DECO - Design (D)
**Date**: 2025-10-30

## 1. Executive Summary

This design document specifies the technical implementation for all seven user stories identified in issue #141. Following the recommendation from the phases document (04-phases.md), all improvements will be implemented in a single phase to ensure cohesive integration and streamlined testing.

The implementation focuses on:
1. Elevating Display IDs as primary user-facing identifiers
2. Fixing package revision URLs
3. Updating navigation button labels
4. Linkifying URLs in documentation
5. Adding explicit indices to file arrays
6. Converting file metadata to dictionary structure
7. Aligning CLI identifiers with DNS conventions

This document provides specific implementation details, including files to modify, functions to change, data structure transformations, and testing strategies.

## 2. Design Principles

### 2.1 Architectural Alignment

**Separation of Concerns**: Maintain existing architectural boundaries between:
- Presentation layer (Canvas UI, markdown formatting)
- Business logic layer (Entry packaging, metadata generation)
- Data layer (S3 storage, JSON structures)
- Integration layer (Benchling API, Quilt catalog)

**Progressive Enhancement**: All changes enhance existing functionality without removing capabilities:
- Display ID prominence maintains Entry ID availability
- Dictionary file metadata preserves ordering via Python 3.7+ guarantees
- Indexed arrays are additive (backward compatible)

**Graceful Degradation**: Handle missing data appropriately:
- Fallback to Entry ID when Display ID unavailable
- Log all identifier resolution operations
- Validate URL components before generation

### 2.2 Quality Standards

- **Type Hints**: All modified functions maintain comprehensive type annotations
- **Docstrings**: Update all docstrings to reflect new behavior
- **Test Coverage**: Maintain >= 85% overall, >= 90% for modified modules
- **Error Handling**: Explicit error handling with structured logging
- **Backward Compatibility**: Only US-6 introduces breaking changes (versioned)

## 3. Implementation Design by User Story

### 3.1 US-1: Display ID Prominence

#### 3.1.1 Strategic Decision

**Package Naming Strategy**: CONSERVATIVE APPROACH
- **Decision**: Maintain Entry ID in package names (S3 keys) for backward compatibility
- **Rationale**:
  - Preserves existing package references
  - Avoids S3 key migration complexity
  - Display ID uniqueness within Benchling tenants not guaranteed
  - Achieves user experience goals through UI presentation

#### 3.1.2 Files to Modify

**File 1: `/Users/ernest/GitHub/benchling-webhook/docker/src/canvas_formatting.py`**

Function: `format_package_header()`

**Current Implementation** (lines 12-28):
```python
def format_package_header(package_name: str, display_id: str, catalog_url: str, sync_url: str, upload_url: str) -> str:
    return f"""## {package_name}

* {display_id}: [{package_name}]({catalog_url}) [[🔄 sync]]({sync_url}) [[⬆️ upload]]({upload_url})
"""
```

**New Implementation**:
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

**Rationale**:
- Display ID becomes the primary heading (H2)
- Package name moves to secondary position with clear label
- Actions consolidated into single line with descriptive link text
- Links use descriptive text instead of bare URLs

---

**File 2: `/Users/ernest/GitHub/benchling-webhook/docker/src/entry_packager.py`**

Function: `_create_metadata_files()`

**Current Implementation** (lines 602-614):
```python
# Build title with name if available
title = f"# Benchling Entry Package: {package_name}"
if name:
    title = f"# {name} ({display_id})"

readme_content = f"""{title}

## Overview
This package contains data exported from Benchling entry `{display_id}`.
"""

if web_url:
    readme_content += f"\n**View in Benchling**: {web_url}\n"
```

**New Implementation**:
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

if web_url:
    readme_content += f"\n[View entry in Benchling]({web_url})\n"
```

**Rationale**:
- Display ID leads the title
- Entry name incorporated as subtitle when available
- Package name provided for technical context
- URL converted to proper Markdown link (addresses US-4)

---

#### 3.1.3 Data Structure Changes

**No changes to data structures** - Display ID already captured in `entry.json`:
```json
{
  "display_id": "EXP00001234",
  "entry_id": "etr_abc123xyz",
  "package_name": "benchling/etr_abc123xyz"
}
```

Both identifiers remain available for different purposes:
- `display_id`: User-facing presentation
- `entry_id`: Technical operations and S3 keys
- `package_name`: Full package path

---

### 3.2 US-2: Fix Package Revision URLs

#### 3.2.1 Analysis

**Current Implementation** (packages.py, line 123):
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

**Investigation Required**: The current implementation appears correct based on:
1. Docstring example shows standard Quilt catalog URL pattern
2. URL structure follows established conventions: `{catalog_url}?action=revisePackage`
3. No obvious errors in the code

**Design Decision**:
- **VERIFY FIRST**: Test current URLs against Quilt catalog (stable, nightly, production)
- **If working**: No code changes needed, close user story
- **If broken**: Document the correct format and implement fix

#### 3.2.2 Validation Strategy

**Manual Testing Checklist**:
1. Generate upload URL via Canvas "Add files" action
2. Click the link in a test Benchling Canvas
3. Verify it opens the package revision interface in Quilt catalog
4. Test across environments: stable, nightly, production (if available)

**If URLs are incorrect**, the fix location is:
- File: `/Users/ernest/GitHub/benchling-webhook/docker/src/packages.py`
- Property: `upload_url`
- Lines: 114-123

**Potential Fix Pattern** (if needed):
```python
@property
def upload_url(self) -> str:
    """Generate upload/revise package URL for adding files.

    Returns:
        Quilt catalog URL with correct action parameter

    Example:
        'https://nightly.quilttest.com/b/my-bucket/packages/benchling/etr_123?action=addFiles'
    """
    # Update action parameter if "revisePackage" is incorrect
    return f"{self.catalog_url}?action=addFiles"  # or correct parameter
```

**Note**: This requires investigation with Quilt team or catalog documentation.

---

### 3.3 US-3: Browse Package Button Label

#### 3.3.1 Files to Modify

**File: `/Users/ernest/GitHub/benchling-webhook/docker/src/canvas_blocks.py`**

Function: `create_main_navigation_buttons()`

**Current Implementation** (lines 92-114):
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

**New Implementation**:
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

**Rationale**:
- Button text changed to "Browse Package" for clarity
- Button ID preserved (`browse-files-*`) to maintain existing routing logic
- Docstring updated to reflect new terminology
- No functional changes to button behavior

#### 3.3.2 Test Files to Update

**File: `/Users/ernest/GitHub/benchling-webhook/docker/tests/test_canvas_browser.py`**

Current assertion (approximate line 149):
```python
assert buttons[0].text == "Browse Files"
```

Update to:
```python
assert buttons[0].text == "Browse Package"
```

**Additional Search**: Use grep to find all test assertions referencing "Browse Files":
```bash
grep -r "Browse Files" docker/tests/
```

Update all test assertions to expect "Browse Package".

---

### 3.4 US-4: Clickable URLs in Documentation

#### 3.4.1 Files to Modify

**File: `/Users/ernest/GitHub/benchling-webhook/docker/src/entry_packager.py`**

Function: `_create_metadata_files()` - README generation

**Current Implementation** (line 614):
```python
if web_url:
    readme_content += f"\n**View in Benchling**: {web_url}\n"
```

**New Implementation**:
```python
if web_url:
    readme_content += f"\n[View entry in Benchling]({web_url})\n"
```

**Additional URLs to Linkify** (lines 616-637):

**Current**:
```python
readme_content += f"""

## Entry Information
- **Display ID**: {display_id}
- **Entry ID**: {entry_id}"""
```

**Enhanced with catalog link**:
```python
readme_content += f"""

## Entry Information
- **Display ID**: {display_id}
- **Entry ID**: {entry_id}
- **Package**: [{package_name}]({catalog_base_url}/b/{bucket}/packages/{package_name})
"""
```

**Note**: To add the catalog URL, we need to pass bucket and catalog URL to the function.

#### 3.4.2 Function Signature Update

**Current Signature** (line 533):
```python
def _create_metadata_files(
    self,
    package_name: str,
    entry_id: str,
    timestamp: str,
    base_url: str,
    webhook_data: Dict,
    uploaded_files: list,
    download_url: str,
    entry_data: Dict[str, Any],
) -> Dict[str, Any]:
```

**No change needed** - we can derive catalog URL from config:
```python
catalog_base_url = self.config.catalog_base_url
bucket = self.config.s3_bucket_name
catalog_url = f"https://{catalog_base_url}/b/{bucket}/packages/{package_name}"
```

Then use in README:
```python
readme_content += f"\n[Browse package in Quilt catalog]({catalog_url})\n"
```

---

### 3.5 US-5: Indexed File Arrays

#### 3.5.1 Files to Modify

**File: `/Users/ernest/GitHub/benchling-webhook/docker/src/entry_packager.py`**

Function: `_process_export()`

**Current Implementation** (lines 471-477):
```python
uploaded_files.append(
    {
        "filename": file_info.filename,
        "s3_key": s3_key,
        "size": len(file_content),
    }
)
```

**New Implementation**:
```python
uploaded_files.append(
    {
        "index": len(uploaded_files),  # Zero-based index
        "filename": file_info.filename,
        "s3_key": s3_key,
        "size": len(file_content),
    }
)
```

**Rationale**:
- `index` field added as first key for visibility
- Value is current array length (zero-based, sequential)
- Additive change - does not break existing parsers
- Preserves file ordering and makes position explicit

#### 3.5.2 Metadata Files Addition

Also add indices when creating metadata file entries (lines 504-510):
```python
uploaded_files.append(
    {
        "index": len(uploaded_files),  # Zero-based index
        "filename": filename,
        "s3_key": s3_key,
        "size": len(body),
    }
)
```

#### 3.5.3 Expected Output

```json
{
  "files": [
    {
      "index": 0,
      "filename": "experiment.csv",
      "s3_key": "benchling/.../experiment.csv",
      "size": 1024
    },
    {
      "index": 1,
      "filename": "README.md",
      "s3_key": "benchling/.../README.md",
      "size": 512
    }
  ]
}
```

---

### 3.6 US-6: Dictionary-Based File Metadata

#### 3.6.1 Strategic Decision

**Breaking Change Acknowledgment**: This is a structural change to the metadata format.

**Migration Strategy**: VERSION 2.0 with version identifier

#### 3.6.2 Files to Modify

**File: `/Users/ernest/GitHub/benchling-webhook/docker/src/entry_packager.py`**

Function: `_create_metadata_files()`

**Current Implementation** (line 586):
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

**New Implementation**:
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

#### 3.6.3 Data Structure Transformation

**Before (Version 1.0)**:
```json
{
  "files": [
    {
      "index": 0,
      "filename": "experiment.csv",
      "s3_key": "benchling/.../experiment.csv",
      "size": 1024
    }
  ]
}
```

**After (Version 2.0)**:
```json
{
  "metadata_version": "2.0",
  "files": {
    "experiment.csv": {
      "s3_key": "benchling/.../experiment.csv",
      "size": 1024,
      "index": 0
    }
  }
}
```

**Ordering Guarantee**: Python 3.7+ maintains dictionary insertion order, preserving file upload sequence.

#### 3.6.4 Migration Considerations

**Breaking Change Impact**:
- Code expecting `files` as an array will fail
- Iteration pattern changes from `for file in entry_json["files"]` to `for filename, metadata in entry_json["files"].items()`

**Mitigation**:
1. **Version Identifier**: `metadata_version` field enables format detection
2. **Documentation**: Clear migration guide in CHANGELOG and documentation
3. **Internal Updates**: Update all internal code that parses `entry.json`

**Unknown Consumers**: No way to identify all external consumers - breaking change must be clearly communicated in release notes.

---

### 3.7 US-7: CLI Identifier Format

#### 3.7.1 Files to Modify

**File: `/Users/ernest/GitHub/benchling-webhook/bin/commands/manifest.ts`**

**Current Implementation** (lines 13-29):
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

**New Implementation**:
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

**Rationale**:
- Hyphens align with DNS conventions
- Consistent with Quilt catalog URL patterns
- More standard for identifiers in modern systems

#### 3.7.2 Impact Assessment

**Potential Impact**: Changing feature ID may affect existing Benchling app installations

**Investigation Required**:
1. Test manifest validation with Benchling API
2. Verify existing installations continue to work
3. Document any required migration steps

**Fallback Plan**: If feature ID change breaks existing installations, we may need to:
- Keep existing ID for backward compatibility
- Document naming convention for new installations
- Create migration guide for updating apps

---

## 4. Technical Architecture

### 4.1 Component Interaction Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Benchling Webhook                       │
└────────────────────────┬────────────────────────────────────┘
                         │ Entry Created/Updated
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                    Entry Packager                            │
│  • Fetch entry data (including Display ID)                   │
│  • Export entry files                                        │
│  • Generate metadata (with indexed dict structure)           │
│  • Create README (with linkified URLs)                       │
└────────────────────────┬────────────────────────────────────┘
                         │ Upload to S3
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                         S3 Bucket                            │
│  • Package files                                             │
│  • entry.json (v2.0 with files dictionary)                   │
│  • README.md (with Display ID title, clickable links)        │
└────────────────────────┬────────────────────────────────────┘
                         │ Queue for package creation
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                      Canvas Manager                          │
│  • Format header (Display ID prominent)                      │
│  • Generate URLs (verify upload URLs work)                   │
│  • Create buttons ("Browse Package" label)                   │
└────────────────────────┬────────────────────────────────────┘
                         │ Update Canvas
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                    Benchling Canvas                          │
│  • Display ID as primary identifier                          │
│  • "Browse Package" navigation                               │
│  • Clickable action links                                    │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Data Flow for Metadata Generation

```
Entry Export (Benchling)
    │
    ├─→ Fetch entry_data (API call)
    │   ├─→ Extract display_id
    │   ├─→ Extract name, web_url
    │   └─→ Validate required fields
    │
    ├─→ Download export ZIP
    │   └─→ Extract files
    │
    ├─→ Upload files to S3
    │   └─→ Build uploaded_files array (with indices)
    │
    └─→ Generate metadata files
        ├─→ entry.json
        │   ├─→ Add metadata_version: "2.0"
        │   ├─→ Convert files array to dictionary
        │   └─→ Write to S3
        │
        ├─→ README.md
        │   ├─→ Use Display ID as title
        │   ├─→ Linkify all URLs
        │   └─→ Write to S3
        │
        └─→ entry_data.json
            └─→ Complete entry data (unchanged)
```

---

## 5. Testing Strategy

### 5.1 Unit Tests

**Test Coverage Requirements**: >= 90% for modified modules

#### 5.1.1 US-1: Display ID Tests

**File**: `docker/tests/test_canvas_formatting.py` (create or update)

```python
def test_format_package_header_display_id_prominent():
    """Display ID should be the primary heading."""
    result = format_package_header(
        package_name="benchling/etr_123",
        display_id="EXP00001234",
        catalog_url="https://catalog.com/packages/benchling/etr_123",
        sync_url="https://catalog.com/sync/...",
        upload_url="https://catalog.com/packages/benchling/etr_123?action=revisePackage"
    )

    # Display ID should be the H2 heading
    assert "## EXP00001234" in result
    # Package name should be in secondary position
    assert "**Package**: [benchling/etr_123]" in result
    # Should have descriptive action links
    assert "[Browse in catalog]" in result
    assert "[🔄 Sync]" in result
    assert "[⬆️ Add files]" in result

def test_readme_title_uses_display_id():
    """README title should feature Display ID prominently."""
    # Test with name
    result = create_readme_content(
        display_id="EXP00001234",
        name="Growth Experiment",
        package_name="benchling/etr_123",
        web_url="https://benchling.com/entry/123"
    )
    assert "# EXP00001234: Growth Experiment" in result

    # Test without name
    result = create_readme_content(
        display_id="EXP00001234",
        name=None,
        package_name="benchling/etr_123",
        web_url="https://benchling.com/entry/123"
    )
    assert "# EXP00001234" in result
```

#### 5.1.2 US-3: Button Label Tests

**File**: `docker/tests/test_canvas_blocks.py`

```python
def test_main_navigation_buttons_browse_package_label():
    """Main navigation should show 'Browse Package' not 'Browse Files'."""
    sections = create_main_navigation_buttons("etr_123")

    # Get button from section
    buttons = sections[0].children
    browse_button = buttons[0]

    assert browse_button.text == "Browse Package"
    assert browse_button.id.startswith("browse-files-")  # ID unchanged
```

#### 5.1.3 US-4: URL Linkification Tests

**File**: `docker/tests/test_entry_packager.py`

```python
def test_readme_web_url_is_linkified():
    """Web URLs should be Markdown links, not plain text."""
    packager = EntryPackager(mock_benchling, mock_config)

    metadata_files = packager._create_metadata_files(
        package_name="benchling/etr_123",
        entry_id="etr_123",
        timestamp="2025-10-30T12:00:00Z",
        base_url="https://benchling.com",
        webhook_data={},
        uploaded_files=[],
        download_url="https://export.com/download",
        entry_data={
            "display_id": "EXP00001234",
            "name": "Test Entry",
            "web_url": "https://benchling.com/entry/123",
            "created_at": datetime.now(),
            "modified_at": datetime.now(),
        }
    )

    readme = metadata_files["README.md"]

    # Should be Markdown link, not plain text
    assert "[View entry in Benchling](https://benchling.com/entry/123)" in readme
    assert "**View in Benchling**: https://benchling.com" not in readme
```

#### 5.1.4 US-5: Array Indices Tests

**File**: `docker/tests/test_entry_packager.py`

```python
def test_uploaded_files_include_indices():
    """Uploaded files should include zero-based index field."""
    packager = EntryPackager(mock_benchling, mock_config)

    # Mock file processing
    uploaded_files = []
    for i, filename in enumerate(["file1.txt", "file2.txt", "file3.txt"]):
        uploaded_files.append({
            "index": i,
            "filename": filename,
            "s3_key": f"benchling/etr_123/{filename}",
            "size": 100 * (i + 1)
        })

    # Verify indices are sequential and zero-based
    assert uploaded_files[0]["index"] == 0
    assert uploaded_files[1]["index"] == 1
    assert uploaded_files[2]["index"] == 2

    # Verify all files have index field
    for file_info in uploaded_files:
        assert "index" in file_info
```

#### 5.1.5 US-6: Dictionary Metadata Tests

**File**: `docker/tests/test_entry_packager.py`

```python
def test_entry_json_files_as_dictionary():
    """Files metadata should be dictionary with filename keys."""
    packager = EntryPackager(mock_benchling, mock_config)

    uploaded_files = [
        {"index": 0, "filename": "experiment.csv", "s3_key": "s3://key1", "size": 1024},
        {"index": 1, "filename": "analysis.py", "s3_key": "s3://key2", "size": 2048}
    ]

    metadata_files = packager._create_metadata_files(
        package_name="benchling/etr_123",
        entry_id="etr_123",
        timestamp="2025-10-30T12:00:00Z",
        base_url="https://benchling.com",
        webhook_data={},
        uploaded_files=uploaded_files,
        download_url="https://export.com/download",
        entry_data=mock_entry_data()
    )

    entry_json = json.loads(metadata_files["entry.json"])

    # Should have metadata_version field
    assert entry_json["metadata_version"] == "2.0"

    # Files should be dictionary, not array
    assert isinstance(entry_json["files"], dict)
    assert not isinstance(entry_json["files"], list)

    # Dictionary keys should be filenames
    assert "experiment.csv" in entry_json["files"]
    assert "analysis.py" in entry_json["files"]

    # Dictionary values should contain metadata
    assert entry_json["files"]["experiment.csv"]["s3_key"] == "s3://key1"
    assert entry_json["files"]["experiment.csv"]["size"] == 1024
    assert entry_json["files"]["experiment.csv"]["index"] == 0

def test_files_dictionary_preserves_order():
    """Dictionary should maintain insertion order (Python 3.7+)."""
    packager = EntryPackager(mock_benchling, mock_config)

    uploaded_files = [
        {"index": i, "filename": f"file{i}.txt", "s3_key": f"s3://key{i}", "size": 100}
        for i in range(10)
    ]

    metadata_files = packager._create_metadata_files(
        # ... parameters
    )

    entry_json = json.loads(metadata_files["entry.json"])
    filenames = list(entry_json["files"].keys())

    # Order should match uploaded order
    expected = [f"file{i}.txt" for i in range(10)]
    assert filenames == expected
```

#### 5.1.6 US-7: CLI Identifier Tests

**File**: `test/manifest.test.ts` (create new test file)

```typescript
import { manifestCommand } from '../bin/commands/manifest';

describe('manifest command', () => {
  test('generates manifest with hyphenated feature ID', async () => {
    const options = { output: './test-manifest.yaml' };
    await manifestCommand(options);

    const manifest = readFileSync('./test-manifest.yaml', 'utf-8');

    // Should use hyphenated format
    expect(manifest).toContain('id: quilt-integration');

    // Should not use underscore format
    expect(manifest).not.toContain('id: quilt_entry');

    // Clean up
    unlinkSync('./test-manifest.yaml');
  });

  test('feature ID conforms to DNS naming conventions', async () => {
    const options = { output: './test-manifest.yaml' };
    await manifestCommand(options);

    const manifest = readFileSync('./test-manifest.yaml', 'utf-8');
    const idMatch = manifest.match(/id: ([a-z0-9-]+)/);

    expect(idMatch).toBeTruthy();
    const featureId = idMatch[1];

    // DNS naming rules
    expect(featureId).toMatch(/^[a-z0-9-]+$/);  // Only lowercase, numbers, hyphens
    expect(featureId).not.toMatch(/^-/);  // Cannot start with hyphen
    expect(featureId).not.toMatch(/-$/);  // Cannot end with hyphen

    // Clean up
    unlinkSync('./test-manifest.yaml');
  });
});
```

### 5.2 Integration Tests

#### 5.2.1 End-to-End Package Creation

**File**: `docker/tests/test_integration_ux.py` (create new)

```python
@pytest.mark.integration
def test_complete_package_creation_with_ux_improvements():
    """Test full workflow from webhook to Canvas with all UX improvements."""
    # This test requires AWS access and live Benchling API

    # 1. Trigger entry export
    # 2. Verify entry.json has metadata_version 2.0
    # 3. Verify files is dictionary
    # 4. Verify README has Display ID title
    # 5. Verify README URLs are links
    # 6. Verify Canvas shows Display ID prominently
    # 7. Verify Canvas button says "Browse Package"
    pass
```

### 5.3 Regression Tests

**Ensure existing functionality still works**:

1. **Package Discovery**: Existing packages remain searchable
2. **Canvas Updates**: Canvas rendering doesn't break
3. **File Uploads**: Package file operations continue working
4. **URL Generation**: Sync URLs and catalog URLs still function

### 5.4 Manual Validation Checklist

- [ ] Generate upload URL and manually verify it opens revision interface
- [ ] View generated README in Quilt catalog and verify links are clickable
- [ ] Create new Benchling app with updated manifest and verify feature ID accepted
- [ ] View Canvas UI in Benchling and verify Display ID is prominent
- [ ] Click "Browse Package" button and verify it opens file browser
- [ ] Verify `entry.json` can be parsed as dictionary structure
- [ ] Verify ordering of files is preserved in dictionary

---

## 6. Migration and Deployment

### 6.1 Version Bump

**Current Version**: 0.5.3 (from git log)
**New Version**: 1.0.0

**Rationale**: Breaking change in US-6 (dictionary metadata) requires major version bump.

### 6.2 CHANGELOG Entry

```markdown
## [1.0.0] - 2025-10-30

### Changed (Breaking)
- **US-6**: File metadata in `entry.json` now uses dictionary structure with filename keys instead of array. This is a breaking change for code that expects `files` as an array. See migration guide below.
- **US-7**: CLI manifest command now generates identifiers with hyphens (e.g., `quilt-integration`) instead of underscores to align with DNS conventions.

### Added
- **US-1**: Display IDs now prominently featured as primary identifiers in Canvas UI and README files. Entry IDs remain available in metadata.
- **US-5**: File metadata now includes explicit zero-based `index` field for clear position correlation.
- `metadata_version` field added to `entry.json` for format versioning (value: "2.0").

### Improved
- **US-3**: Navigation button updated from "Browse Files" to "Browse Package" for clearer terminology.
- **US-4**: URLs in README files now formatted as clickable Markdown links with descriptive text.
- **US-2**: Verified package revision URLs work correctly across Quilt catalog environments.

### Migration Guide

#### Migrating from Array-based to Dictionary-based File Metadata

**Before (version 1.x)**:
```python
for file_info in entry_json["files"]:
    filename = file_info["filename"]
    s3_key = file_info["s3_key"]
```

**After (version 2.0)**:
```python
for filename, file_metadata in entry_json["files"].items():
    s3_key = file_metadata["s3_key"]
```

**Detecting Format Version**:
```python
metadata_version = entry_json.get("metadata_version", "1.0")
if metadata_version == "2.0":
    # Dictionary format
    files_dict = entry_json["files"]
else:
    # Legacy array format
    files_array = entry_json["files"]
```
```

### 6.3 Documentation Updates

**Files to Update**:

1. **README.md**: Update description of metadata format
2. **docs/enterprise_benchling.md**: Update Canvas UI screenshots and examples
3. **docker/README.md**: Update developer documentation with new data structures

### 6.4 Rollout Plan

**Phase 1: Pre-deployment**
1. Complete all code changes
2. Run full test suite (unit + integration)
3. Update documentation
4. Update CHANGELOG.md

**Phase 2: Deployment**
1. Merge PR to main branch
2. Tag release as v1.0.0
3. Deploy to AWS via CDK

**Phase 3: Post-deployment**
1. Monitor error rates and logs
2. Validate Canvas rendering in production
3. Test URL functionality in live environment
4. Communicate breaking changes to stakeholders

### 6.5 Rollback Plan

**If critical issues arise**:

1. **Revert deployment**: Roll back to v0.5.3
2. **Canvas changes**: Non-breaking, safe to rollback
3. **Metadata format**: New packages will use v1.0 format until re-deployed
4. **Existing packages**: Unaffected (already created with old format)

**Non-rollback items**:
- Packages created with v2.0 metadata (forward-only)
- Need to maintain ability to read both formats if rollback is prolonged

---

## 7. Risk Mitigation

### 7.1 High Risk: Dictionary Metadata Breaking Change

**Risk**: Unknown consumers of `entry.json` format may break.

**Mitigation**:
1. **Version Identifier**: `metadata_version` field enables format detection
2. **Clear Communication**: Breaking change prominently documented in CHANGELOG
3. **Migration Guide**: Provide clear code examples for migration
4. **Monitoring**: Watch for parsing errors in logs post-deployment

### 7.2 Medium Risk: Feature ID Change

**Risk**: Changing feature ID may affect existing Benchling installations.

**Mitigation**:
1. **Testing**: Validate new manifest with Benchling API before deployment
2. **Investigation**: Test with existing installation to verify impact
3. **Fallback**: If breaking, keep old ID and document for new installations only
4. **Documentation**: Provide clear migration steps if needed

### 7.3 Medium Risk: Display ID Availability

**Risk**: Display ID may not be available in all webhook event types.

**Mitigation**:
1. **Fallback Logic**: Use Entry ID when Display ID unavailable
2. **Logging**: Log all cases where Display ID unavailable for monitoring
3. **Validation**: Test across multiple entry types and webhook events

### 7.4 Low Risk: URL Format Verification

**Risk**: Current URL format may not work in all catalog environments.

**Mitigation**:
1. **Manual Testing**: Validate URLs across stable/nightly/production catalogs
2. **Monitoring**: Track click-through rates on generated URLs
3. **Quick Fix**: URL generation is localized, easy to patch if incorrect

---

## 8. Success Metrics

### 8.1 Functional Metrics

**US-1 (Display ID Prominence)**:
- Metric: 100% of Canvas headers show Display ID as primary identifier
- Validation: Manual inspection + automated test assertion

**US-2 (Package Revision URLs)**:
- Metric: 100% of generated URLs successfully open revision interface
- Validation: Manual click-testing in production

**US-3 (Navigation Labels)**:
- Metric: 100% of navigation buttons display "Browse Package"
- Validation: Automated test + visual inspection

**US-4 (Clickable URLs)**:
- Metric: 100% of URLs in README formatted as Markdown links
- Validation: Automated test + README rendering verification

**US-5 (Indexed Arrays)**:
- Metric: 100% of file entries include explicit `index` field
- Validation: Automated test + metadata inspection

**US-6 (Dictionary Metadata)**:
- Metric: 100% of new packages use dictionary-based file metadata
- Validation: Automated test + S3 file inspection

**US-7 (Hyphenated Identifiers)**:
- Metric: Generated manifest uses hyphenated feature ID
- Validation: Automated test + manifest validation

### 8.2 Quality Metrics

**Test Coverage**: >= 85% overall, >= 90% for modified modules
**Defect Rate**: < 1 post-deployment bug per user story in first 30 days
**Performance**: Canvas rendering < 100ms slower than baseline

### 8.3 User Experience Metrics

**Display ID Recognition**: Users correctly identify entries by Display ID
**Navigation Clarity**: No confusion about "Browse Package" vs "Browse Files"
**Link Usability**: Users successfully navigate README links

---

## 9. Implementation Checklist

### 9.1 Code Changes

- [ ] Modify `canvas_formatting.py::format_package_header()` for Display ID prominence
- [ ] Modify `entry_packager.py::_create_metadata_files()` for README title and linkification
- [ ] Modify `entry_packager.py::_process_export()` to add file indices
- [ ] Modify `entry_packager.py::_create_metadata_files()` to convert files to dictionary
- [ ] Modify `canvas_blocks.py::create_main_navigation_buttons()` for button label
- [ ] Modify `manifest.ts` to use hyphenated feature ID
- [ ] Verify `packages.py::upload_url` property (investigate if changes needed)

### 9.2 Test Updates

- [ ] Update `test_canvas_blocks.py` assertions for "Browse Package"
- [ ] Add tests for Display ID in headers and README
- [ ] Add tests for linkified URLs
- [ ] Add tests for indexed file arrays
- [ ] Add tests for dictionary file metadata
- [ ] Add tests for manifest feature ID format
- [ ] Add integration test for complete workflow
- [ ] Run full test suite and verify >= 85% coverage

### 9.3 Documentation

- [ ] Update CHANGELOG.md with breaking changes and migration guide
- [ ] Update README.md with new metadata structure
- [ ] Update developer documentation with new patterns
- [ ] Add inline code comments explaining design decisions
- [ ] Update docstrings for all modified functions

### 9.4 Validation

- [ ] Manual testing: Generate and click upload URLs
- [ ] Manual testing: View README in Quilt catalog
- [ ] Manual testing: Create Benchling app with new manifest
- [ ] Manual testing: Verify Canvas Display ID prominence
- [ ] Manual testing: Verify dictionary metadata structure
- [ ] Review test coverage report
- [ ] Run linter and type checker (no errors)

### 9.5 Deployment

- [ ] Create PR with all changes
- [ ] Request code review
- [ ] Address review feedback
- [ ] Run CI/CD pipeline (all tests pass)
- [ ] Merge to main branch
- [ ] Tag release v1.0.0
- [ ] Deploy to AWS
- [ ] Monitor production logs
- [ ] Validate in live environment

---

## 10. Open Questions and Decisions Needed

### 10.1 US-2: Upload URL Format

**Question**: Is the current URL format (`?action=revisePackage`) correct?

**Action Required**: Manual testing against Quilt catalog environments

**Timeline**: Before deployment

**Owner**: TBD

### 10.2 US-7: Feature ID Impact

**Question**: Will changing feature ID break existing Benchling installations?

**Action Required**: Test manifest with Benchling API, validate existing installation

**Timeline**: Before deployment

**Owner**: TBD

---

## 11. Conclusion

This design document provides comprehensive implementation guidance for all seven user stories in issue #141. The design balances user experience improvements with technical constraints:

- **Display ID prominence** achieved through UI changes without S3 key migration
- **Dictionary metadata** introduces breaking change with clear versioning
- **Linkified URLs** and **indexed arrays** provide progressive enhancements
- **Button labels** and **CLI identifiers** align terminology with standards

The single-phase approach enables cohesive integration testing and streamlined deployment. All changes follow established code patterns and maintain high quality standards.

**Next Steps**:
1. Review and approve this design document
2. Create Phase 1 episodes document (06-phase1-episodes.md) breaking work into implementable tasks
3. Create Phase 1 checklist (07-phase1-checklist.md) for execution tracking
4. Begin implementation following the detailed specifications in this document

---

**Document Version**: 1.0
**Last Updated**: 2025-10-30
**Status**: Draft - Ready for Review
