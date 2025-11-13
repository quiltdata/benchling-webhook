/**
 * Execution context detector
 *
 * Determines whether CLI is running in repository (with source files)
 * or via npx (installed package), enabling appropriate command suggestions.
 *
 * @module lib/context-detector
 */

import * as fs from "fs";
import * as path from "path";
import { ExecutionContext } from "./types/next-steps";

/**
 * Package name constant
 */
const PACKAGE_NAME = "@quiltdata/benchling-webhook";

/**
 * Source directory name
 */
const SOURCE_DIR = "lib";

/**
 * Package.json structure
 */
interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Detect execution context
 *
 * Determines whether the CLI is running in repository context (with source files)
 * or via npx (installed package) by examining the file system for:
 * 1. package.json with matching name
 * 2. Source TypeScript files in lib/ directory
 * 3. Available npm scripts
 *
 * @returns Execution context information
 *
 * @example
 * ```typescript
 * const context = detectExecutionContext();
 * if (context.isRepository) {
 *   console.log('Running in repository');
 *   console.log('Available scripts:', context.availableScripts);
 * } else {
 *   console.log('Running via npx');
 * }
 * ```
 */
export function detectExecutionContext(): ExecutionContext {
    try {
    // Find package.json
        const pkgPath = findPackageJson();
        if (!pkgPath) {
            // No package.json found - assume npx
            return createNpxContext();
        }

        // Read and parse package.json
        const pkg = readPackageJson(pkgPath);
        if (!pkg || pkg.name !== PACKAGE_NAME) {
            // Wrong package or invalid - assume npx
            return createNpxContext();
        }

        // Check for source files
        const hasSourceFiles = checkForSourceFiles(pkgPath);
        if (hasSourceFiles) {
            // Has source files - repository context
            return createRepositoryContext(pkg);
        }

        // No source files - npx context
        return createNpxContext();
    } catch {
    // On any error, default to npx context (safer)
        return createNpxContext();
    }
}

/**
 * Find package.json by walking up directory tree
 *
 * Starts from current working directory and walks up until package.json
 * is found or filesystem root is reached.
 *
 * @returns Path to package.json or null if not found
 */
function findPackageJson(): string | null {
    try {
        let dir = process.cwd();
        const root = path.parse(dir).root;

        while (dir !== root) {
            const pkgPath = path.join(dir, "package.json");
            if (fs.existsSync(pkgPath)) {
                return pkgPath;
            }
            dir = path.dirname(dir);
        }

        // Check root directory as well
        const rootPkgPath = path.join(root, "package.json");
        if (fs.existsSync(rootPkgPath)) {
            return rootPkgPath;
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * Read and parse package.json
 *
 * @param pkgPath - Path to package.json
 * @returns Parsed package.json or null on error
 */
function readPackageJson(pkgPath: string): PackageJson | null {
    try {
        const content = fs.readFileSync(pkgPath, "utf-8");
        const pkg = JSON.parse(content) as unknown;

        // Validate it's an object
        if (typeof pkg !== "object" || pkg === null || Array.isArray(pkg)) {
            return null;
        }

        return pkg as PackageJson;
    } catch {
        return null;
    }
}

/**
 * Check if source files exist in lib/ directory
 *
 * Looks for TypeScript (.ts) files in the lib/ directory relative
 * to package.json location. Presence of .ts files indicates repository context.
 *
 * @param pkgPath - Path to package.json
 * @returns True if source TypeScript files found
 */
function checkForSourceFiles(pkgPath: string): boolean {
    try {
        const pkgDir = path.dirname(pkgPath);
        const libDir = path.join(pkgDir, SOURCE_DIR);

        // Check if lib directory exists
        if (!fs.existsSync(libDir)) {
            return false;
        }

        // Check for TypeScript files
        const files = fs.readdirSync(libDir);
        return files.some((f) => f.endsWith(".ts"));
    } catch {
        return false;
    }
}

/**
 * Extract available npm scripts from package.json
 *
 * @param pkg - Parsed package.json object
 * @returns Array of script names
 */
function extractAvailableScripts(pkg: PackageJson): string[] {
    try {
        if (!pkg || !pkg.scripts || typeof pkg.scripts !== "object") {
            return [];
        }
        return Object.keys(pkg.scripts);
    } catch {
        return [];
    }
}

/**
 * Create repository context object
 *
 * @param pkg - Parsed package.json object
 * @returns Repository execution context
 */
function createRepositoryContext(pkg: PackageJson): ExecutionContext {
    return {
        isRepository: true,
        isNpx: false,
        packageName: PACKAGE_NAME,
        availableScripts: extractAvailableScripts(pkg),
    };
}

/**
 * Create npx context object
 *
 * @returns NPX execution context
 */
function createNpxContext(): ExecutionContext {
    return {
        isRepository: false,
        isNpx: true,
        packageName: PACKAGE_NAME,
        availableScripts: [],
    };
}
