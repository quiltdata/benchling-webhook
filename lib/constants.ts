export const FILES = {
    ENTRY_JSON: "entry.json",
    RO_CRATE_METADATA_JSON: "ro-crate-metadata.json",
    README_MD: "README.md",
};

export const README_TEMPLATE = `
# Quilt Package Engine for Benchling Notebooks.

This package contains the data and metadata for a Benchling Notebook entry.

## Files

- ${FILES.ENTRY_JSON}: Entry data
- ${FILES.RO_CRATE_METADATA_JSON}: Webhook event message
- ${FILES.README_MD}: This README file
`;

export const MIME_TYPES = {
    "html": "text/html",
    "css": "text/css",
    "js": "application/javascript",
    "json": "application/json",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "txt": "text/plain",
    "pdf": "application/pdf",
} as const;
