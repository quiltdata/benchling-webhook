import { FILES } from "../constants";

export const README_TEMPLATE = `
# Quilt Package Engine for Benchling Notebooks.

This package contains the data and metadata for a Benchling Notebook entry.

## Files

- ${FILES.ENTRY_JSON}: Entry data
- ${FILES.INPUT_JSON}: Webhook event message
- ${FILES.README_MD}: This README file
`;
