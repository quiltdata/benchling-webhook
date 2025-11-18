/**
 * Deploy Command - NPX Compatibility Test
 *
 * This test validates that the deploy command uses direct TypeScript imports
 * instead of npm script invocations, ensuring NPX compatibility.
 *
 * Issue #221 - Phase 4: Fix Missing `setup:sync-secrets` Script in NPX Context
 *
 * The problem: When running `npx @quiltdata/benchling-webhook`, the deploy command
 * was trying to execute `npm run setup:sync-secrets` which failed because npm looks
 * for scripts in the user's CWD, not the installed package.
 *
 * The solution: Import and call `syncSecretsToAWS()` directly instead of using execSync
 * with npm scripts.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

describe("Deploy Command NPX Compatibility", () => {
    it("should import syncSecretsToAWS directly instead of using npm scripts", () => {
        // Read the deploy.ts source file
        const deployPath = join(__dirname, "../bin/commands/deploy.ts");
        const deploySource = readFileSync(deployPath, "utf-8");

        // Verify that syncSecretsToAWS is imported
        expect(deploySource).toMatch(/import\s+{\s*syncSecretsToAWS\s*}\s+from\s+["']\.\/sync-secrets["']/);

        // Verify that we're NOT using npm run setup:sync-secrets
        expect(deploySource).not.toMatch(/npm\s+run\s+setup:sync-secrets/);

        // Verify that syncSecretsToAWS is actually called (not just imported)
        expect(deploySource).toMatch(/await\s+syncSecretsToAWS\s*\(/);
    });

    it("should call syncSecretsToAWS with correct parameters", () => {
        const deployPath = join(__dirname, "../bin/commands/deploy.ts");
        const deploySource = readFileSync(deployPath, "utf-8");

        // Verify the function is called with profile, region, and force parameters
        // This regex looks for the syncSecretsToAWS call with an object parameter
        expect(deploySource).toMatch(/syncSecretsToAWS\s*\(\s*{/);

        // Should contain profile parameter
        expect(deploySource).toMatch(/profile:\s*options\.profileName/);

        // Should contain region parameter
        expect(deploySource).toMatch(/region:\s*deployRegion/);

        // Should contain force: false to not update existing secrets
        expect(deploySource).toMatch(/force:\s*false/);
    });

    it("should provide NPX-compatible error messages", () => {
        const deployPath = join(__dirname, "../bin/commands/deploy.ts");
        const deploySource = readFileSync(deployPath, "utf-8");

        // Error messages should suggest NPX commands, not npm scripts
        expect(deploySource).toMatch(/npx\s+@quiltdata\/benchling-webhook\s+setup/);

        // Should NOT suggest npm run commands for secret syncing
        const lines = deploySource.split("\n");
        const errorMessageLines = lines.filter(line =>
            line.includes("To sync secrets manually") ||
            line.includes("console.log") && line.includes("sync-secrets")
        );

        // None of the error message lines should contain "npm run"
        errorMessageLines.forEach(line => {
            if (line.includes("sync")) {
                expect(line).not.toMatch(/npm\s+run/);
            }
        });
    });

    it("should suppress console output during secret sync", () => {
        const deployPath = join(__dirname, "../bin/commands/deploy.ts");
        const deploySource = readFileSync(deployPath, "utf-8");

        // Should temporarily override console.log
        expect(deploySource).toMatch(/const\s+originalLog\s*=\s*console\.log/);
        expect(deploySource).toMatch(/console\.log\s*=\s*\(\s*\)\s*:\s*void\s*=>\s*{}/);

        // Should restore console.log in a finally block
        expect(deploySource).toMatch(/finally\s*{[\s\S]*console\.log\s*=\s*originalLog/);
    });

    it("should handle secret sync results properly", () => {
        const deployPath = join(__dirname, "../bin/commands/deploy.ts");
        const deploySource = readFileSync(deployPath, "utf-8");

        // Should check result actions
        expect(deploySource).toMatch(/action\s*===\s*["']created["']/);
        expect(deploySource).toMatch(/action\s*===\s*["']skipped["']/);
        expect(deploySource).toMatch(/action\s*===\s*["']updated["']/);

        // Should display appropriate messages
        expect(deploySource).toMatch(/created and verified/);
        expect(deploySource).toMatch(/verified \(existing\)/);
        expect(deploySource).toMatch(/verified and updated/);
    });
});

describe("Sync Secrets Module Exports", () => {
    it("should export syncSecretsToAWS function", () => {
        const syncSecretsPath = join(__dirname, "../bin/commands/sync-secrets.ts");
        const syncSecretsSource = readFileSync(syncSecretsPath, "utf-8");

        // Verify the function is exported
        expect(syncSecretsSource).toMatch(/export\s+async\s+function\s+syncSecretsToAWS/);
    });

    it("should export SyncResult type", () => {
        const syncSecretsPath = join(__dirname, "../bin/commands/sync-secrets.ts");
        const syncSecretsSource = readFileSync(syncSecretsPath, "utf-8");

        // Verify the type is defined (interfaces are implicitly exported when used in export)
        expect(syncSecretsSource).toMatch(/interface\s+SyncResult/);
        expect(syncSecretsSource).toMatch(/Promise<SyncResult\[\]>/);
    });
});

describe("Documentation", () => {
    it("should have specification document for the fix", () => {
        const specPath = join(__dirname, "../spec/221-next-steps/14-npx-missing-script-fix.md");
        const specExists = existsSync(specPath);

        expect(specExists).toBe(true);

        if (specExists) {
            const specContent = readFileSync(specPath, "utf-8");

            // Verify key sections exist
            expect(specContent).toMatch(/## Problem Analysis/);
            expect(specContent).toMatch(/## Solution Design/);
            expect(specContent).toMatch(/Option 1: Direct TypeScript Import/);
            expect(specContent).toMatch(/NPX Compatible/);
        }
    });
});
