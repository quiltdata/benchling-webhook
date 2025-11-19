# A03: Browse Linked Packages

## Overview

Enable users to browse linked packages directly within Benchling by clicking Browse buttons below the Linked Packages section. Each Browse button must encode sufficient information to route to the correct package's file browser.

## Problem Statement

Currently, the Canvas displays linked packages as markdown links to the Quilt catalog. Users cannot browse these linked packages within the Benchling Canvas interface. The main challenge is that the Browse button handler needs to know:

1. **Which package** to browse (the linked package name)
2. **Which entry** triggered the canvas (for context/logging)

## Requirements

### User Experience

1. Display a horizontal row of "Browse" buttons below the Linked Packages list
2. One Browse button per linked package, in the same order as listed
3. Clicking a Browse button opens the Package Entry Browser for that linked package
4. The browser should work identically to browsing the primary package

### Technical Requirements

1. Button IDs must encode both the package name and entry ID
2. Button IDs must be parseable by the existing button router
3. Button IDs must be stable (same package → same button ID)
4. Button handler must create a CanvasManager for the linked package

## Design

### Button ID Format

We need a button ID format that encodes:

- Action prefix: `browse-linked-`
- Entry ID: for logging and context
- Package identifier: to determine which package to browse
- Pagination: page number and size (default: p0-s15)

**Proposed Format:**

```
browse-linked-{entry_id}-pkg-{encoded_package_name}-p{page}-s{size}
```

Where `{encoded_package_name}` is the package name with `/` replaced by `--` (double dash) to avoid parsing issues.

**Example:**

```
browse-linked-etr_abc123-pkg-benchling--experiment-001-p0-s15
```

Decodes to:

- Entry ID: `etr_abc123`
- Package name: `benchling/experiment-001`
- Page: 0
- Size: 15

### Alternative Encoding Schemes

#### Option 1: Double-dash separator (RECOMMENDED)

- Replace `/` with `--` in package name
- Pro: Simple, readable, reversible
- Con: Package names could theoretically contain `--`
- Example: `benchling/exp-001` → `benchling--exp-001`

#### Option 2: Base64 encoding

- Encode package name in base64
- Pro: Handles any characters
- Con: Not human-readable, bloated button IDs
- Example: `benchling/exp-001` → `YmVuY2hsaW5nL2V4cC0wMDE=`

#### Option 3: Index-based lookup

- Use index in linked packages list
- Pro: Short button IDs
- Con: Requires storing linked packages in session/canvas state
- Example: `browse-linked-etr_abc123-idx-0-p0-s15`

**Decision: Use Option 1 (double-dash separator)** for simplicity and readability.

### Button ID Parsing

The button router must extract:

1. Entry ID (for logging)
2. Package name (for browsing)
3. Page number and size (for pagination)

**Parsing Logic:**

```python
def parse_browse_linked_button_id(button_id: str):
    """
    Parse browse-linked button ID.

    Format: browse-linked-{entry_id}-pkg-{encoded_pkg}-p{page}-s{size}
    Example: browse-linked-etr_abc123-pkg-benchling--exp-001-p0-s15

    Returns:
        tuple: (entry_id, package_name, page_number, page_size)
    """
    # Remove prefix
    rest = button_id.replace("browse-linked-", "", 1)

    # Extract entry_id (everything before "-pkg-")
    entry_id, rest = rest.split("-pkg-", 1)

    # Extract encoded package name (everything before "-p")
    encoded_pkg, rest = rest.rsplit("-p", 1)

    # Decode package name: replace "--" back to "/"
    package_name = encoded_pkg.replace("--", "/")

    # Extract page and size
    page_str, size_str = rest.split("-s", 1)
    page_number = int(page_str)
    page_size = int(size_str)

    return (entry_id, package_name, page_number, page_size)
```

### Button Handler

**New handler function:**

```python
def handle_browse_linked(payload, button_id, benchling, config):
    """Handle Browse Linked Package button click.

    Creates a Package Entry Browser for the linked package.
    Uses the linked package name instead of deriving from entry_id.
    """
    # Parse button ID to extract package name
    entry_id, package_name, page_number, page_size = parse_browse_linked_button_id(button_id)

    logger.info("Browse linked package requested",
                entry_id=entry_id,
                package_name=package_name,
                page=page_number)

    # Create a specialized canvas manager for the linked package
    # This bypasses the normal package name derivation from entry_id
    canvas_manager = CanvasManager(benchling, config, payload)

    # Override the package name
    canvas_manager._package = Package(
        catalog_base_url=config.quilt_catalog,
        bucket=config.s3_bucket_name,
        package_name=package_name,
    )

    # Generate browser blocks for the linked package
    blocks = canvas_manager.get_package_browser_blocks(page_number, page_size)

    # Update canvas asynchronously
    # ... (similar to existing browse handler)
```

### UI Layout

**Before:**

```markdown
### Linked Packages

* [benchling/exp-001](https://catalog.com/...) [[🔄 sync]](...)
* [benchling/exp-002](https://catalog.com/...) [[🔄 sync]](...)
```

**After:**

```markdown
### Linked Packages

* [benchling/exp-001](https://catalog.com/...) [[🔄 sync]](...)
* [benchling/exp-002](https://catalog.com/...) [[🔄 sync]](...)

[Browse] [Browse]
```

The Browse buttons appear in a horizontal row, corresponding to the order of linked packages above.

### Navigation Flow

1. User clicks "Browse" button for linked package
2. Canvas updates to show Package Entry Browser for that linked package
3. File list pagination works normally (Next/Previous buttons)
4. "Back to Package" returns to the original entry's main canvas view
5. Navigation buttons use the linked package name consistently

## Implementation Plan

### 1. Update `canvas_blocks.py`

Add `create_linked_package_browse_buttons()`:

- Accept list of Package objects and entry_id
- Generate button ID with encoded package name
- Return section with horizontal button layout

### 2. Update `canvas.py`

Modify `_make_blocks()`:

- Store `_linked_packages` instance variable
- Call `create_linked_package_browse_buttons()` after markdown block
- Add linked browse button section to blocks list

### 3. Add button ID parser

Add to `pagination.py` (or new module):

- `parse_browse_linked_button_id()` function
- Encode/decode package name with `--` separator
- Extract entry_id, package_name, page, size

### 4. Update `app.py` router

Add handler for `browse-linked-*` buttons:

- Route to new `handle_browse_linked()` function
- Parse button ID to extract package name
- Create canvas manager with overridden package

### 5. Implement `handle_browse_linked()`

Add to `app.py`:

- Parse button ID
- Create CanvasManager with linked package
- Override `_package` to use linked package name
- Generate browser blocks
- Update canvas asynchronously

### 6. Update canvas_formatting.py

Modify `format_linked_packages()`:

- Add spacing/separator before Browse buttons section
- Ensure visual alignment with button row below

## Edge Cases

### Multiple Linked Packages

The button row scales horizontally with the number of linked packages. Benchling's Canvas UI should handle horizontal button wrapping.

### No Linked Packages

When `_linked_packages` is empty:

- `create_linked_package_browse_buttons()` returns empty list
- No Browse buttons appear
- Canvas remains unchanged from current behavior

### Package Not Found

When browsing a linked package that doesn't exist:

- Existing error handling in `get_package_browser_blocks()` applies
- User sees "Package Not Created" message
- "Back to Package" returns to original entry

### Package Name Edge Cases

#### Package names with double-dash

- Package: `benchling/exp--001`
- Encoded: `benchling--exp----001`
- Decoded: `benchling/exp--001` ✓

#### Package names with special characters

- Package: `benchling/exp_001`
- Encoded: `benchling--exp_001`
- No issues with underscores, numbers, etc.

### Button ID Length Limits

Benchling Canvas button IDs have a practical limit. Long package names may exceed this:

- Maximum button ID length: ~255 characters (typical)
- Worst case package name: ~200 characters
- Encoded with metadata: ~240 characters
- Should fit within limits for typical package names

If package names are very long, consider truncating with hash:

```
browse-linked-{entry_id}-pkg-{truncated}...{hash}-p{page}-s{size}
```

## Testing

### Unit Tests

1. Test `parse_browse_linked_button_id()`:
   - Standard package names
   - Package names with dashes
   - Package names with underscores
   - Invalid button ID formats

2. Test `create_linked_package_browse_buttons()`:
   - Empty package list
   - Single package
   - Multiple packages
   - Button ID encoding

### Integration Tests

1. Click Browse button for linked package
2. Verify correct package browser appears
3. Verify pagination works
4. Verify "Back to Package" returns to original entry
5. Test with multiple linked packages

### Manual Testing

1. Create entry with multiple linked packages
2. Open Canvas
3. Verify Browse buttons appear below Linked Packages
4. Click each Browse button
5. Verify correct package opens
6. Test navigation (Next, Previous, Back)

## Migration Notes

This is a purely additive feature:

- No breaking changes to existing functionality
- New button handler is opt-in (only triggered by new button IDs)
- Existing browse behavior unchanged
- No database or configuration changes required

## Future Enhancements

### Browse Button Labels

Instead of generic "Browse", show first few chars of package name:

```
[Browse exp-001] [Browse exp-002]
```

### Direct Navigation

Allow browsing linked packages without returning to main canvas:

- Add "Browse Other Linked Packages" dropdown in browser view
- Quick-switch between linked packages

### Metadata Comparison

Add ability to compare metadata across linked packages:

- "Compare Metadata" button
- Side-by-side view of multiple packages

## References

- Existing browse handler: `app.py:handle_browse_files()`
- Button ID parsing: `pagination.py:parse_button_id()`
- Canvas blocks: `canvas_blocks.py:create_main_navigation_buttons()`
- Package file fetching: `package_files.py:PackageFileFetcher`
