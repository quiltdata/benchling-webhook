export const EXPORT_STATUS = {
    RUNNING: "RUNNING",
    SUCCEEDED: "SUCCEEDED",
    FAILED: "FAILED",
} as const;

export const FILES = {
    ENTRY_JSON: "entry.json",
    RO_CRATE_METADATA_JSON: "ro-crate-metadata.json",
    README_MD: "README.md",
} as const;

export const MIME_TYPES = {
    HTML: "text/html",
    CSS: "text/css",
    JS: "application/javascript",
    JSON: "application/json",
    PNG: "image/png",
    JPEG: "image/jpeg",
    GIF: "image/gif",
    TXT: "text/plain",
    PDF: "application/pdf",
    DEFAULT: "application/octet-stream",
} as const;

export const README_TEMPLATE = `
# Quilt Package Engine for Benchling Notebooks.

This package contains the data and metadata for a Benchling Notebook entry.

## Files

- ${FILES.ENTRY_JSON}: Entry data
- ${FILES.RO_CRATE_METADATA_JSON}: Webhook event message
- ${FILES.README_MD}: This README file
`;
