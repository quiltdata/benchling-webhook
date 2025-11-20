#!/usr/bin/env node

/**
 * Version management script - bumps version numbers and creates release tags
 *
 * Usage:
 *   node bin/version.ts          # Show all three version files
 *   node bin/version.ts patch    # 0.4.7 -> 0.4.8
 *   node bin/version.ts minor    # 0.4.7 -> 0.5.0
 *   node bin/version.ts major    # 0.4.7 -> 1.0.0
 *   node bin/version.ts sync     # Force TOML and YAML to match JSON version
 *   node bin/version.ts tag      # Create and push production release tag
 *   node bin/version.ts tag dev  # Create and push dev release tag
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

interface PackageJson {
    version: string;
    [key: string]: unknown;
}

interface VersionParts {
    major: number;
    minor: number;
    patch: number;
}

type BumpType = "major" | "minor" | "patch";

const packagePath = path.join(__dirname, "..", "package.json");
const pyprojectPath = path.join(__dirname, "..", "docker", "pyproject.toml");
const appManifestPath = path.join(__dirname, "..", "docker", "app-manifest.yaml");
const pkg: PackageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

function readPyprojectVersion(): string | null {
    const content = fs.readFileSync(pyprojectPath, "utf8");
    const match = content.match(/^version\s*=\s*"([^"]+)"/m);
    return match ? match[1] : null;
}

function readAppManifestVersion(): string | null {
    const content = fs.readFileSync(appManifestPath, "utf8");
    const match = content.match(/^\s*version:\s*(.+)$/m);
    return match ? match[1].trim() : null;
}

function parseVersion(version: string): VersionParts {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!match) {
        throw new Error(`Invalid version format: ${version}`);
    }
    return {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        patch: parseInt(match[3], 10),
    };
}

function formatVersion(ver: VersionParts): string {
    return `${ver.major}.${ver.minor}.${ver.patch}`;
}

function bumpVersion(currentVersion: string, bumpType: BumpType): string {
    const ver = parseVersion(currentVersion);

    switch (bumpType) {
    case "major":
        ver.major++;
        ver.minor = 0;
        ver.patch = 0;
        break;
    case "minor":
        ver.minor++;
        ver.patch = 0;
        break;
    case "patch":
        ver.patch++;
        break;
    default:
        throw new Error(`Unknown bump type: ${bumpType}`);
    }

    return formatVersion(ver);
}

function updatePackageVersion(newVersion: string): void {
    pkg.version = newVersion;
    fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`✅ Updated package.json to version ${newVersion}`);
}

function updatePyprojectVersion(newVersion: string): void {
    let content = fs.readFileSync(pyprojectPath, "utf8");
    content = content.replace(/^version\s*=\s*"[^"]+"/m, `version = "${newVersion}"`);
    fs.writeFileSync(pyprojectPath, content);
    console.log(`✅ Updated docker/pyproject.toml to version ${newVersion}`);

    // Run uv sync to update uv.lock
    try {
        const dockerDir = path.join(__dirname, "..", "docker");
        console.log("🔄 Running uv sync to update uv.lock...");
        execSync("uv sync", { cwd: dockerDir, stdio: "inherit" });
        console.log("✅ Updated docker/uv.lock");
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("⚠️  Warning: Failed to run uv sync:", message);
        console.error("   You may need to run 'cd docker && uv sync' manually");
    }
}

function updateAppManifestVersion(newVersion: string): void {
    let content = fs.readFileSync(appManifestPath, "utf8");
    content = content.replace(/^(\s*)version:\s*.+$/m, `$1version: ${newVersion}`);
    fs.writeFileSync(appManifestPath, content);
    console.log(`✅ Updated docker/app-manifest.yaml to version ${newVersion}`);
}

function createGitTag(version: string, isDev: boolean, noPush: boolean): void {
    let tagName = `v${version}`;

    // For dev releases, append timestamp to make unique
    if (isDev) {
        const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
        tagName = `v${version}-${timestamp}`;
    }

    const tagType = isDev ? "pre-release (dev)" : "release";

    // Check if tag already exists
    try {
        execSync(`git rev-parse ${tagName}`, { stdio: "ignore" });
        console.error(`❌ Tag ${tagName} already exists`);
        process.exit(1);
    } catch {
        // Tag doesn't exist, continue
    }

    // Create tag
    const message = isDev
        ? `Development ${tagType} ${tagName}\n\nThis is a pre-release for testing purposes.`
        : `Release ${tagName}`;

    execSync(`git tag -a ${tagName} -m "${message}"`, { stdio: "inherit" });
    console.log(`✅ Created git tag ${tagName}`);

    // Push tag unless --no-push is specified
    if (!noPush) {
        console.log("");
        console.log(`Pushing tag ${tagName} to origin...`);
        try {
            execSync(`git push origin ${tagName}`, { stdio: "inherit" });
            console.log(`✅ Pushed tag ${tagName} to origin`);
            console.log("");
            console.log("CI/CD pipeline will now:");
            console.log("  - Run all tests");
            console.log("  - Build and push Docker image to ECR");
            console.log("  - Create GitHub release");
            if (!isDev) {
                console.log("  - Publish to NPM (production releases only)");
            }
            console.log("  - Publish to GitHub Packages");
            console.log("");
            console.log("Monitor progress at: https://github.com/quiltdata/benchling-webhook/actions");
        } catch {
            console.error(`❌ Failed to push tag ${tagName}`);
            console.error("You can manually push with: git push origin " + tagName);
            process.exit(1);
        }
    } else {
        console.log("");
        console.log("Tag created but not pushed (--no-push specified)");
        console.log(`To push later: git push origin ${tagName}`);
    }
}

function main(): void {
    const args = process.argv.slice(2);

    // No args: display all three versions
    if (args.length === 0) {
        const jsonVersion = pkg.version;
        const tomlVersion = readPyprojectVersion();
        const yamlVersion = readAppManifestVersion();

        console.log("Version files:");
        console.log(`  package.json:              ${jsonVersion}`);
        console.log(`  docker/pyproject.toml:     ${tomlVersion}`);
        console.log(`  docker/app-manifest.yaml:  ${yamlVersion}`);

        if (jsonVersion === tomlVersion && jsonVersion === yamlVersion) {
            console.log("\n✅ All versions are in sync");
        } else {
            console.log("\n⚠️  Versions are out of sync! Run \"node bin/version.ts sync\" to fix.");
        }
        process.exit(0);
    }

    // Help
    if (args.includes("--help") || args.includes("-h")) {
        console.log("Current version:", pkg.version);
        console.log("");
        console.log("Usage: node bin/version.ts [command] [options]");
        console.log("");
        console.log("Version Management Commands:");
        console.log("  (no args)  - Display all three version files");
        console.log("  major      - Bump major version (1.0.0 -> 2.0.0)");
        console.log("  minor      - Bump minor version (0.4.7 -> 0.5.0)");
        console.log("  patch      - Bump patch version (0.4.7 -> 0.4.8)");
        console.log("  sync       - Force TOML and YAML to match JSON version");
        console.log("");
        console.log("Release Tagging Commands:");
        console.log("  tag        - Create and push production release tag");
        console.log("  tag dev    - Create and push dev release tag with timestamp");
        console.log("");
        console.log("Options:");
        console.log("  --no-push  - Create tag but do not push to origin (tag command only)");
        console.log("");
        console.log("This script manages version numbers in:");
        console.log("  - package.json");
        console.log("  - docker/pyproject.toml");
        console.log("  - docker/app-manifest.yaml");
        console.log("  - docker/uv.lock (via uv sync)");
        console.log("");
        console.log("Examples:");
        console.log("  npm run version              # Show versions");
        console.log("  npm run version patch        # Bump patch version");
        console.log("  npm run version:tag          # Create production release tag");
        console.log("  npm run version:tag:dev      # Create dev release tag");
        process.exit(0);
    }

    const bumpType = args[0];

    // Sync command - force TOML and YAML to match JSON
    if (bumpType === "sync") {
        const jsonVersion = pkg.version;
        const tomlVersion = readPyprojectVersion();
        const yamlVersion = readAppManifestVersion();

        console.log("Syncing versions to match package.json:");
        console.log(`  package.json:              ${jsonVersion}`);
        console.log(`  docker/pyproject.toml:     ${tomlVersion} -> ${jsonVersion}`);
        console.log(`  docker/app-manifest.yaml:  ${yamlVersion} -> ${jsonVersion}`);
        console.log("");

        try {
            updatePyprojectVersion(jsonVersion);
            updateAppManifestVersion(jsonVersion);

            // Check if version files have changes
            let hasChanges = false;
            try {
                execSync("git diff --quiet docker/pyproject.toml docker/app-manifest.yaml docker/uv.lock", { stdio: "ignore" });
            } catch {
                hasChanges = true;
            }

            if (hasChanges) {
                execSync("git add docker/pyproject.toml docker/app-manifest.yaml docker/uv.lock", { stdio: "inherit" });
                execSync(`git commit -m "chore: sync versions to ${jsonVersion}"`, { stdio: "inherit" });
                console.log("✅ Committed version sync");
            } else {
                console.log("✅ All versions already in sync (no changes to commit)");
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("❌ Error:", message);
            process.exit(1);
        }
        process.exit(0);
    }

    // Tag command - create and push git tags
    if (bumpType === "tag") {
        // Check for uncommitted changes
        try {
            execSync("git diff-index --quiet HEAD --", { stdio: "ignore" });
        } catch {
            console.error("❌ You have uncommitted changes");
            console.error("   Commit or stash your changes before creating a release");
            process.exit(1);
        }

        const isDev = args.includes("dev");
        const noPush = args.includes("--no-push");
        const version = pkg.version;

        console.log(`Creating ${isDev ? "dev" : "production"} release from version: ${version}`);
        console.log("");

        createGitTag(version, isDev, noPush);
        process.exit(0);
    }

    // Check for uncommitted changes (for version bump commands)
    try {
        execSync("git diff-index --quiet HEAD --", { stdio: "ignore" });
    } catch {
        console.error("❌ You have uncommitted changes");
        console.error("   Commit or stash your changes before bumping version");
        process.exit(1);
    }

    try {
        const currentVersion = pkg.version;
        const newVersion = bumpVersion(currentVersion, bumpType as BumpType);

        console.log(`Bumping version: ${currentVersion} -> ${newVersion}`);
        console.log("");

        // Update all version files
        updatePackageVersion(newVersion);
        updatePyprojectVersion(newVersion);
        updateAppManifestVersion(newVersion);

        // Commit the changes
        execSync("git add package.json docker/pyproject.toml docker/app-manifest.yaml docker/uv.lock", { stdio: "inherit" });
        execSync(`git commit -m "chore: bump version to ${newVersion}"`, { stdio: "inherit" });
        console.log("✅ Committed version change");
        console.log("");
        console.log("Next steps:");
        console.log("  1. Push changes: git push");
        console.log("  2. Create release tag: npm run version:tag (or npm run version:tag:dev for dev release)");

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("❌ Error:", message);
        process.exit(1);
    }
}

main();
