import { writeFileSync } from "fs";
import chalk from "chalk";
import boxen from "boxen";
import { loadConfigSync, type ConfigOptions } from "../../lib/utils/config";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require("../../package.json");

export interface ManifestOptions {
    catalogDomain?: string;
    version?: string;
}

/**
 * Generates the Benchling application manifest used during setup.
 *
 * @param options - Manifest generation options
 * @returns Manifest YAML as a string
 */
export function generateBenchlingManifest(options: ManifestOptions = {}): string {
    const version = options.version || pkg.version;

    // Generate app name from catalog domain if available
    let appName = "Quilt Integration";
    if (options.catalogDomain) {
        // Replace dots and colons with hyphens to create a valid identifier
        appName = options.catalogDomain.replace(/[.:]/g, "-");
    }

    return `manifestVersion: 1
info:
  name: ${appName}
  description: Package Benchling notebook entries as Quilt data packages
  version: ${version}
features:
  - name: Quilt Package
    id: quilt-entry
    type: CANVAS
subscriptions:
  deliveryMethod: WEBHOOK
  messages:
    - type: v2.canvas.userInteracted
    - type: v2.canvas.created
    - type: v2.entry.created
    - type: v2.entry.updated.fields
`;
}

export async function manifestCommand(options: ConfigOptions & { output?: string }): Promise<void> {
    const config = loadConfigSync(options);
    const outputPath = options.output || "app-manifest.yaml";

    const manifest = generateBenchlingManifest({
        catalogDomain: config.quiltCatalog,
        version: pkg.version,
    });

    try {
        writeFileSync(outputPath, manifest);
        console.log(chalk.green(`✓ Created ${outputPath}`));
        console.log();
        console.log(
            boxen(
                `${chalk.bold("Next steps:")}\n\n` +
          "1. Upload this manifest to Benchling:\n" +
          `   ${chalk.cyan("https://docs.benchling.com/docs/getting-started-benchling-apps#creating-an-app-from-a-manifest")}\n\n` +
          "2. Copy the App Definition ID from the app overview page\n\n" +
          "3. Install the app in your Benchling tenant (don't set webhook URL yet):\n" +
          `   ${chalk.cyan("https://docs.benchling.com/docs/getting-started-benchling-apps#installing-your-app")}\n\n` +
          "4. Deploy to AWS:\n" +
          `   ${chalk.cyan("npx @quiltdata/benchling-webhook")}\n` +
          `   ${chalk.dim("(You'll be prompted for the App Definition ID)")}\n\n` +
          "5. After deployment, set the webhook URL in your Benchling app settings",
                { padding: 1, borderColor: "blue", borderStyle: "round" },
            ),
        );
    } catch (error) {
        console.error(chalk.red(`✗ Failed to create manifest: ${(error as Error).message}`));
        process.exit(1);
    }
}
