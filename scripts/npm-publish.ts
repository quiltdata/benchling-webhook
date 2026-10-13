#!/usr/bin/env node

/**
 * Retry-safe npm publication with monotonic shared dist-tags.
 *
 * npm trusted publishing (OIDC) authorizes only `npm publish`; `npm dist-tag`
 * needs a registry token. Promotion therefore happens atomically inside
 * `npm publish --tag <channel>`, and stale candidates are parked under a
 * per-version tag so a shared channel never moves backward.
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { compareReleaseVersions, parseReleaseVersion } from "./version";

export interface NpmRegistry {
    versions(packageName: string): string[];
    distTags(packageName: string): Record<string, string>;
    publish(tag: string): void;
}

export interface PublishResult {
    immutableCreated: boolean;
    channel: "latest" | "dev";
    promotion: "initialized" | "promoted" | "current" | "stale";
}

interface PackageJson {
    name: string;
    version: string;
}

export interface NpmCommandResult {
    status: number;
    stdout: string;
    stderr: string;
}

export type NpmCommandRunner = (args: readonly string[], inherit?: boolean) => NpmCommandResult;

function npmError(args: readonly string[], result: NpmCommandResult): Error {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit status ${result.status}`;
    return new Error(`npm ${args.join(" ")} failed: ${detail}`);
}

export const defaultNpmRunner: NpmCommandRunner = (args, inherit = false) => {
    const result = spawnSync("npm", [...args], {
        encoding: "utf8",
        stdio: inherit ? "inherit" : "pipe",
    });
    return {
        status: result.status ?? 127,
        stdout: result.stdout?.toString() ?? "",
        stderr: [result.stderr?.toString(), result.error?.message].filter(Boolean).join("\n"),
    };
};

function parseJson(value: string, label: string): unknown {
    try {
        return JSON.parse(value);
    } catch (error) {
        throw new Error(`Malformed npm ${label} response: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export class CliNpmRegistry implements NpmRegistry {
    public constructor(private readonly runner: NpmCommandRunner = defaultNpmRunner) {}

    public versions(packageName: string): string[] {
        const args = ["view", packageName, "versions", "--json"];
        const result = this.runner(args);
        if (result.status !== 0) {
            throw npmError(args, result);
        }
        const parsed = parseJson(result.stdout, "versions");
        const versions = typeof parsed === "string" ? [parsed] : parsed;
        if (!Array.isArray(versions) || !versions.every((version) => typeof version === "string")) {
            throw new Error("Malformed npm versions response: expected a string array");
        }
        return versions;
    }

    public distTags(packageName: string): Record<string, string> {
        const args = ["view", packageName, "dist-tags", "--json"];
        const result = this.runner(args);
        if (result.status !== 0) {
            throw npmError(args, result);
        }
        const parsed = parseJson(result.stdout, "dist-tags");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Malformed npm dist-tags response: expected an object");
        }
        for (const value of Object.values(parsed)) {
            if (typeof value !== "string") {
                throw new Error("Malformed npm dist-tags response: expected string versions");
            }
        }
        return parsed as Record<string, string>;
    }

    public publish(tag: string): void {
        const args = ["publish", "--provenance", "--access", "public", "--tag", tag];
        const result = this.runner(args, true);
        if (result.status !== 0) {
            throw npmError(args, result);
        }
    }
}

export function parkingDistTag(version: string): string {
    return `release-${version.replace(/[^0-9A-Za-z-]/g, "-")}`;
}

function promotionDecision(candidate: string, current: string | undefined): PublishResult["promotion"] {
    if (!current) {
        return "initialized";
    }
    const comparison = compareReleaseVersions(candidate, current);
    if (comparison > 0) {
        return "promoted";
    }
    return comparison === 0 ? "current" : "stale";
}

export function publishRelease(
    registry: NpmRegistry,
    packageName: string,
    version: string,
    packageVersion: string,
): PublishResult {
    const release = parseReleaseVersion(version);
    if (packageVersion !== version) {
        throw new Error(`package.json version ${packageVersion} does not match release ${version}`);
    }

    const channel = release.prerelease ? "dev" : "latest";
    const immutableCreated = !registry.versions(packageName).includes(version);
    const current = registry.distTags(packageName)[channel];
    if (current) {
        const currentRelease = parseReleaseVersion(current);
        if (!release.prerelease && currentRelease.prerelease) {
            throw new Error(`npm latest must point to a plain semantic version, found ${current}`);
        }
    }

    const promotion = promotionDecision(version, current);
    const advancesChannel = promotion === "initialized" || promotion === "promoted";
    if (immutableCreated) {
        registry.publish(advancesChannel ? channel : parkingDistTag(version));
    } else if (advancesChannel) {
        throw new Error(
            `${packageName}@${version} is already published but npm ${channel} is ${current ?? "unset"}; ` +
            `trusted publishing cannot move dist-tags, so run: npm dist-tag add ${packageName}@${version} ${channel}`,
        );
    }

    return {
        immutableCreated,
        channel,
        promotion,
    };
}

function readPackageJson(): PackageJson {
    const packagePath = path.join(__dirname, "..", "package.json");
    const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8")) as Partial<PackageJson>;
    if (typeof parsed.name !== "string" || typeof parsed.version !== "string") {
        throw new Error("package.json must contain string name and version fields");
    }
    return parsed as PackageJson;
}

export function main(args = process.argv.slice(2)): number {
    try {
        const pkg = readPackageJson();
        const version = args[0] ?? process.env.RELEASE_VERSION ?? pkg.version;
        const result = publishRelease(new CliNpmRegistry(), pkg.name, version, pkg.version);
        console.log(`npm ${result.channel}: immutable=${result.immutableCreated}, promotion=${result.promotion}`);
        return 0;
    } catch (error) {
        console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

if (require.main === module) {
    process.exitCode = main();
}
