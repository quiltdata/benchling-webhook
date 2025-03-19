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

