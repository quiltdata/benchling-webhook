#!/usr/bin/env node

/** Retry-safe npm publication with monotonic shared dist-tags. */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { compareReleaseVersions, parseReleaseVersion } from "./version";

export interface NpmRegistry {
    versions(packageName: string): string[];
    distTags(packageName: string): Record<string, string>;
    publish(temporaryTag: string): void;
    setDistTag(packageName: string, version: string, tag: string): void;
    removeDistTag(packageName: string, tag: string): void;
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

    public publish(temporaryTag: string): void {
        const args = ["publish", "--provenance", "--access", "public", "--tag", temporaryTag];
        const result = this.runner(args, true);
        if (result.status !== 0) {
            throw npmError(args, result);
        }
    }

    public setDistTag(packageName: string, version: string, tag: string): void {
        const args = ["dist-tag", "add", `${packageName}@${version}`, tag];
        const result = this.runner(args, true);
        if (result.status !== 0) {
            throw npmError(args, result);
        }
    }

    public removeDistTag(packageName: string, tag: string): void {
        const args = ["dist-tag", "rm", packageName, tag];
        const result = this.runner(args, true);
        if (result.status !== 0) {
            throw npmError(args, result);
        }
    }
}

export function temporaryDistTag(version: string): string {
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

function combineFailures(primary: unknown, cleanup: unknown): Error {
    const primaryMessage = primary instanceof Error ? primary.message : String(primary);
    const cleanupMessage = cleanup instanceof Error ? cleanup.message : String(cleanup);
    return new Error(`${primaryMessage}; temporary dist-tag cleanup also failed: ${cleanupMessage}`);
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
    const temporaryTag = temporaryDistTag(version);
    const existingVersions = registry.versions(packageName);
    const immutableCreated = !existingVersions.includes(version);
    let publishedWithTemporaryTag = false;
    let knownTemporaryTag = false;
    let primaryFailure: unknown;
    let promotion: PublishResult["promotion"] = "current";

    try {
        if (immutableCreated) {
            registry.publish(temporaryTag);
            publishedWithTemporaryTag = true;
        }

        const tags = registry.distTags(packageName);
        knownTemporaryTag = tags[temporaryTag] === version;
        const current = tags[channel];
        if (current) {
            const currentRelease = parseReleaseVersion(current);
            if (!release.prerelease && currentRelease.prerelease) {
                throw new Error(`npm latest must point to a plain semantic version, found ${current}`);
            }
        }

        promotion = promotionDecision(version, current);
        if (promotion === "initialized" || promotion === "promoted") {
            registry.setDistTag(packageName, version, channel);
        }
    } catch (error) {
        primaryFailure = error;
    }

    let cleanupFailure: unknown;
    if (publishedWithTemporaryTag || knownTemporaryTag) {
        try {
            registry.removeDistTag(packageName, temporaryTag);
        } catch (error) {
            cleanupFailure = error;
        }
    }

    if (primaryFailure && cleanupFailure) {
        throw combineFailures(primaryFailure, cleanupFailure);
    }
    if (primaryFailure) {
        throw primaryFailure;
    }
    if (cleanupFailure) {
        throw cleanupFailure;
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
