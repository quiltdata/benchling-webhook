# Requirements Document: UX Improvements

## GitHub Issue Reference

**Issue**: #141 - UX improvements
**URL**: https://github.com/quiltdata/benchling-webhook/issues/141

## Problem Statement

The current Benchling webhook integration has several user experience issues that reduce clarity and usability:

1. Package names and headings use technical Entry IDs instead of human-readable Display IDs
2. Package revision URLs are not correctly formatted
3. Navigation button text "Browse Files" is misleading (should be "Browse Package")
4. URLs in Markdown files are not clickable links
5. JSON arrays with file metadata lack indices, making it difficult to correlate keys with specific files
6. File metadata is stored as an array instead of a more accessible dictionary structure
7. CLI manifest command generates identifiers that don't match catalog DNS format conventions

These issues impact user experience across multiple touchpoints: the Canvas UI, generated documentation, metadata files, and CLI tooling.

## User Stories

### US-1: Display Human-Readable Entry Identifiers

**As a** lab scientist using the Benchling Canvas integration
**I want** to see human-readable Display IDs (e.g., "EXP00001234") instead of technical Entry IDs (e.g., "etr_abc123xyz")
**So that** I can easily identify entries by the same identifiers I use in Benchling

**Acceptance Criteria**:
- Canvas UI shows Display ID in package headings and descriptions
- README.md files use Display ID as the primary identifier in titles
- Display ID is prominently featured alongside the package name
- Entry ID remains available in metadata for technical reference

### US-2: Working Package Revision URLs

**As a** user wanting to add files to an existing package
**I want** the "upload" action links to open the correct revision interface
**So that** I can successfully add or update files in my packages

**Acceptance Criteria**:
- Upload/revise links use the correct URL format and query parameters
- Clicking upload links opens the Quilt catalog package revision interface
- URLs work correctly across different catalog environments (stable, nightly, production)

### US-3: Clear Package Navigation

**As a** user navigating the Canvas interface
**I want** the top-level button to say "Browse Package" instead of "Browse Files"
**So that** the terminology matches the package-centric model and reduces confusion

**Acceptance Criteria**:
- Main navigation button is labeled "Browse Package"
- Button functionality remains unchanged (opens package file browser)
- Label accurately reflects that users are browsing package contents

### US-4: Clickable URLs in Documentation

**As a** user reading package README files in the Quilt catalog
**I want** URLs to be formatted as Markdown links
**So that** I can click them to navigate directly to referenced resources

**Acceptance Criteria**:
- URLs in README.md are formatted as `[text](url)` Markdown links
- Links include descriptive text indicating their destination
- All relevant URLs (Benchling entry, package catalog, etc.) are clickable
- Links render correctly in both the Quilt catalog and when viewing raw Markdown

### US-5: Indexed File Arrays in Metadata

**As a** developer or data analyst parsing package metadata
**I want** file entries in JSON arrays to include array indices
**So that** I can clearly identify which metadata keys correspond to which files

**Acceptance Criteria**:
- Each file entry in metadata arrays includes an explicit index field
- Index values are zero-based and sequential
- Index is preserved consistently across all metadata representations
- Existing metadata consumers can still parse the enhanced format

### US-6: Dictionary-Based File Metadata

**As a** developer or data analyst working with package metadata
**I want** file metadata stored as a dictionary with filenames as keys
**So that** I can efficiently look up information about specific files without iterating through arrays

**Acceptance Criteria**:
- `entry.json` file metadata uses dictionary structure: `{"filename": {...metadata...}}`
- Dictionary keys are the logical file paths/names
- Dictionary values contain file metadata (size, s3_key, etc.)
- Migration maintains backward compatibility where possible
- Documentation updated to reflect new structure

### US-7: Catalog-Aligned Package Identifiers

**As a** developer running the CLI manifest command
**I want** generated package identifiers to use hyphen separators matching catalog DNS conventions
**So that** package names are consistent across the entire system

**Acceptance Criteria**:
- CLI `manifest` command generates identifiers with hyphens (e.g., "quilt-integration")
- Identifiers conform to DNS naming conventions used by Quilt catalogs
- Existing package names remain valid and accessible
- Documentation clarifies the naming convention

## Implementation Approach (High-Level)

The improvements span multiple areas of the system:

1. **Canvas UI** (Python): Update display logic to prioritize Display ID over Entry ID in markdown formatting and UI blocks
2. **Entry Packager** (Python): Modify metadata generation to use dictionary structure for files and include Display ID
3. **README Generation** (Python): Update template to feature Display ID prominently and linkify URLs
4. **Canvas Blocks** (Python): Update button text from "Browse Files" to "Browse Package"
5. **Package URLs** (Python): Verify and correct URL generation for revision/upload actions
6. **CLI Manifest** (TypeScript): Update identifier generation to use hyphen separators
7. **Metadata Schema**: Enhance JSON schema to support both indexed arrays and dictionary structures

Each change should be tested individually and maintain backward compatibility where feasible.

## Success Criteria

1. **User Clarity**: Users can immediately identify entries using familiar Display IDs
2. **Functional URLs**: All package action URLs (browse, sync, upload) work correctly
3. **Navigation Clarity**: Button labels accurately describe their actions
4. **Documentation Usability**: README files have clickable, descriptive links
5. **Developer Experience**: File metadata is easily accessible via dictionary lookup
6. **System Consistency**: Package identifiers follow consistent naming conventions
7. **No Regressions**: Existing functionality continues to work with new improvements
8. **Test Coverage**: All changes have corresponding test coverage (85%+ overall)

## Open Questions

1. **Display ID Availability**: Are Display IDs consistently available in all webhook event types, or do we need fallback logic?
2. **Backward Compatibility**: Should we maintain the array-based file metadata for a transition period, or is a breaking change acceptable?
3. **Migration Path**: Do existing packages need metadata updates, or only new/updated packages?
4. **URL Format Verification**: What are the exact URL patterns expected by different Quilt catalog versions?
5. **Index Numbering**: Should file indices be 0-based (developer convention) or 1-based (user convention)?
6. **Package Name Migration**: Should existing packages be renamed to follow the new hyphen convention, or only apply to new packages?
7. **Testing Scope**: Are there specific catalog environments or Benchling tenants that require special testing?
