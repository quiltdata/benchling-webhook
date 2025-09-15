export const EXPORT_STATUS = {
    RUNNING: "RUNNING",
    SUCCEEDED: "SUCCEEDED",
    FAILED: "FAILED",
} as const;

export const FILES = {
    ENTRY_JSON: "entry.json",
    INPUT_JSON: "input.json",
    README_MD: "README.md",
    ENTRY_MD: "entry.md",
    ASSAY_RESULTS_JSON: "assay-results.json",
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
    MD: "text/markdown",
    ZIP: "application/zip",
    YAML: "application/yaml",
    YML: "application/yaml",
    DEFAULT: "application/octet-stream",
} as const;

