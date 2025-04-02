import { FILES } from "../constants";

export const README_TEMPLATE = 
"# Package With Quilt\n\n" +
"## Benchling Webhook Example\n\n" +
"This auto-generated package uses Amazon Step Functions " + 
"to collect data and metadata" +
"for the Benchling Notebook entry: {} ({}).\n\n" +
"## Files\n\n" +
"- [{}](./{}): Entry data\n" +
"- [{}](./{}): Webhook event message\n";
