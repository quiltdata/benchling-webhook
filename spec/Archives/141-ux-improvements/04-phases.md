# Phase Planning Document

## Issue #141: UX Improvements

**Date:** 2025-10-30
**Methodology:** I RASP DECO - Phases (P)

---

## Overview

This document breaks down the implementation of 7 user stories into logical, independently testable phases. Each phase represents a potential PR that can be merged incrementally.

### Guiding Principles

1. **Low-risk before high-risk**: Simple changes first, complex changes later
2. **Non-breaking before breaking**: Maintain backward compatibility where possible
3. **Dependencies respected**: Changes that depend on others come later
4. **Pre-factoring opportunities**: Refactor to make future changes easier
5. **Independent testing**: Each phase should be fully testable in isolation

---

## Phase Breakdown

### Phase 1: Display Improvements (Non-Breaking)

**Risk Level:** Low
**Breaking Changes:** None
**Dependencies:** None
**Estimated Complexity:** Simple

**User Stories:**
- US-1: Use DisplayID versus EntryID for package name/heading
- US-3: The top-level 'Browse Files' should actually be 'Browse Package'

**Rationale:**
These are simple, localized changes to display strings that don't affect data structures or external interfaces. They provide immediate UX value with minimal risk.

**Implementation Areas:**
- Canvas block text (Browse Files → Browse Package)
- Package heading to use DisplayID instead of EntryID
- No API or data structure changes

**Testing Strategy:**
- Unit tests for canvas block generation
- Integration tests for package display
- Existing tests should pass unchanged

**Acceptance Criteria:**
- Package headings show DisplayID instead of EntryID
- Top-level navigation shows "Browse Package" instead of "Browse Files"
- All existing functionality remains intact

---

### Phase 2: URL Linkification (Non-Breaking)

**Risk Level:** Low
**Breaking Changes:** None
**Dependencies:** None
**Estimated Complexity:** Simple-Medium

**User Stories:**
- US-4: Linkify URLs in Markdown files

**Rationale:**
This is an enhancement to Markdown rendering that doesn't change data structures or require API modifications. It's a pure display improvement.

**Implementation Areas:**
- Markdown parser/renderer in canvas formatting
- URL pattern detection
- Link generation logic

**Testing Strategy:**
- Unit tests for URL detection patterns
- Integration tests for Markdown rendering
- Test various URL formats (http, https, relative, absolute)

**Acceptance Criteria:**
- URLs in Markdown are automatically converted to clickable links
- Existing Markdown rendering remains unchanged
- Various URL formats are correctly detected and linked

---

### Phase 3: Indexed Arrays and Revise URLs (Non-Breaking)

**Risk Level:** Medium
**Breaking Changes:** None
**Dependencies:** None
**Estimated Complexity:** Medium

**User Stories:**
- US-2: Fix the revise-package URLs
- US-5: JSON arrays need indices so we can tell which keys go with which file

**Rationale:**
These two changes can be combined as they both improve data clarity without breaking existing functionality. US-5 adds indices to arrays (additive), and US-2 fixes URL generation (bug fix).

**Implementation Areas:**
- URL generation logic for package revision
- JSON array indexing in entry metadata
- entry.json structure enhancement

**Testing Strategy:**
- Unit tests for URL generation
- Unit tests for array indexing
- Integration tests for revision workflows
- Manual verification of generated links and JSON structure

**Acceptance Criteria:**
- Revise-package URLs correctly point to the intended destination
- JSON arrays include index information
- Existing links remain functional
- entry.json format is backward compatible (additive only)

---

### Phase 4: Files Dictionary and CLI Identifier (Breaking)

**Risk Level:** High
**Breaking Changes:** Yes
**Dependencies:** Phases 1-3 completed
**Estimated Complexity:** High

**User Stories:**
- US-6: 'files' metadata should be a dictionary (with filename as key) instead of an array
- US-7: cli 'manifest' should change the identifier to match the catalog DNS (with '-' instead of '.')

**Rationale:**
These are the two breaking changes that improve the data model and CLI consistency. They're combined into one phase to minimize the number of breaking releases.

**Implementation Areas:**
- Core entry.json data structure (files array → dictionary)
- CLI manifest identifier format
- Package metadata structure
- All code that reads/writes files metadata

**Migration Strategy:**
1. Document breaking changes clearly
2. Provide migration script if needed
3. Update all examples and documentation
4. Consider deprecation period with warnings

**Testing Strategy:**
- Comprehensive unit tests for new structure
- Integration tests for all affected workflows
- Migration tests (if applicable)
- Performance testing (dictionary lookups vs array iteration)
- Manual testing of CLI behavior

**Acceptance Criteria:**
- Files metadata is a dictionary with filename as key
- CLI manifest uses '-' instead of '.' in identifiers
- All functionality works with new formats
- Migration guide published
- Documentation updated
- CHANGELOG clearly documents breaking changes

---

## Phase Dependencies Graph

```
Phase 1 (Display) ─┐
                   ├──> All independent, can be done in parallel
Phase 2 (Linkify) ─┤
                   │
Phase 3 (Arrays/URLs)─┘
                   │
                   └──> Phase 4 (Breaking Changes)
```

**Legend:**
- Phases 1, 2, 3: Independent, can be done in parallel or sequentially
- Phase 4: Should come after 1-3 are complete and stable

---

## Risk Assessment by Phase

| Phase | Risk Level | Breaking | Rollback Difficulty | Impact Scope |
|-------|-----------|----------|---------------------|--------------|
| 1     | Low       | No       | Trivial             | Display only |
| 2     | Low       | No       | Easy                | Display only |
| 3     | Medium    | No       | Easy                | JSON/URLs    |
| 4     | High      | Yes      | Difficult           | Core data    |

---

## Version Implications

### Phases 1-3 (Non-Breaking)
- **Version Type:** Minor (additive features and bug fixes)
- **Example:** 0.5.3 → 0.6.0

### Phase 4 (Breaking Changes)
- **Version Type:** Major
- **Example:** 0.6.x → 1.0.0 (or 0.7.0 if staying pre-1.0)

---

## Recommended Implementation Order

For this specific issue, I recommend implementing **all 7 user stories in a single phase** because:

1. **The changes are actually simple**: Despite being categorized as breaking, US-6 and US-7 are straightforward refactors
2. **Already on a feature branch**: We're on `141-ux-improvements` branch, so we can do all work here
3. **User explicitly requested all 7 items**: The issue lists all 7 improvements together
4. **Testing together is easier**: Integration testing all changes together ensures they work well together
5. **Single PR review**: Easier for reviewers to see the complete picture

### Single-Phase Approach: All UX Improvements

**Combined Implementation:**
- US-1: DisplayID in headings (simple)
- US-2: Fix revise URLs (simple)
- US-3: Browse Package label (trivial)
- US-4: Linkify URLs (medium)
- US-5: Array indices (medium)
- US-6: Files dictionary (medium-high)
- US-7: CLI identifier format (medium)

**Version:** Bump to 1.0.0 (breaking changes in US-6, US-7)

**Testing:** Complete integration test suite covering all 7 changes

**Timeline:** Single PR, comprehensive review, merge when all tests pass

---

## Next Steps

1. ✅ Review this phase plan
2. Create Phase 1 design document (05-phase1-design.md)
3. Create Phase 1 episodes document (06-phase1-episodes.md)
4. Create Phase 1 checklist document (07-phase1-checklist.md)
5. Begin implementation with orchestrator agent
6. Run tests, create PR, iterate until passing

---

## Success Metrics

### Overall Success Criteria
- All 7 user stories implemented
- Test coverage maintained or improved
- No regressions in existing functionality
- Documentation updated
- PR approved and merged to main

### Quality Gates
- [ ] All tests passing (unit, integration, E2E)
- [ ] Linting passing
- [ ] Type checking passing
- [ ] Code coverage ≥85%
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] No IDE diagnostics
- [ ] PR description complete and clear
