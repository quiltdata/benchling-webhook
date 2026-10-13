#!/usr/bin/env node

/**
 * Version management and release-tag tooling.
 *
 * Version bumps remain explicit commands. Release commands share tag construction,
 * local/remote target verification, and annotated-tag creation semantics.
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

interface PackageJson {
    version: string;
    [key: string]: unknown;
}

interface VersionParts {
    major: number;
    minor: number;
    patch: number;
}

export interface ReleaseVersion extends VersionParts {
    raw: string;
    prerelease: boolean;
    timestamp?: string;
}

export interface CommandResult {
    status: number;
    stdout: string;
    stderr: string;
}

export interface CommandOptions {
    cwd: string;
    inherit?: boolean;
}

export type CommandRunner = (
    command: string,
    args: readonly string[],
    options: CommandOptions,
) => CommandResult;

type BumpType = "major" | "minor" | "patch";

export type AutoTagOutcome =
    | "no-version-change"
    | "non-production-version"
    | "verified-existing-tag"
    | "verified-recovered-tag"
    | "created"
    | "verified-race";

export interface AutoTagResult {
    outcome: AutoTagOutcome;
    releaseRequired: boolean;
    verified: boolean;
    tag: string;
    targetSha: string;
}

export interface ReleaseContext {
    verified: boolean;
    tag: string;
    version: string;
    baseVersion: string;
    targetSha: string;
    isPrerelease: boolean;
}

export interface TagAnnotation {
    message: string;
    taggerName: string;
    taggerEmail: string;
}

export interface RemoteReleaseTag {
    targetSha: string;
    annotation: TagAnnotation | null;
}

export interface ReleaseRepository {
    resolveCommit(ref: string): string;
    commitExists(ref: string): boolean;
    readFileAtCommit(commit: string, file: string): string;
    localTagTarget(tag: string): string | null;
    remoteTag(tag: string): RemoteReleaseTag | null;
    createAnnotatedTag(tag: string, message: string, targetSha: string): void;
    pushTag(tag: string): boolean;
    isClean(): boolean;
}

export interface AutomaticReleaseOptions {
    repository: ReleaseRepository;
    currentVersion: string;
    beforeSha?: string;
    githubSha: string;
    runProductionGate: () => void;
}

const projectRoot = path.join(__dirname, "..");
const packagePath = path.join(projectRoot, "package.json");
const pyprojectPath = path.join(projectRoot, "docker", "pyproject.toml");
const appManifestPath = path.join(projectRoot, "docker", "app-manifest.yaml");
export const AUTOMATIC_RELEASE_TAGGER_NAME = "github-actions[bot]";
export const AUTOMATIC_RELEASE_TAGGER_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";
const CORE_VERSION_PATTERN = "(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)";
const PLAIN_VERSION_PATTERN = new RegExp(`^${CORE_VERSION_PATTERN}$`);
const TIMESTAMP_VERSION_PATTERN = new RegExp(`^${CORE_VERSION_PATTERN}-(\\d{8}T\\d{6}Z)$`);
const SEMVER_PATTERN = new RegExp(
    `^${CORE_VERSION_PATTERN}(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`,
);

export const defaultCommandRunner: CommandRunner = (command, args, options) => {
    const result = spawnSync(command, [...args], {
        cwd: options.cwd,
        encoding: "utf8",
        stdio: options.inherit ? "inherit" : "pipe",
    });

    return {
        status: result.status ?? 127,
        stdout: result.stdout?.toString() ?? "",
        stderr: [result.stderr?.toString(), result.error?.message].filter(Boolean).join("\n"),
    };
};

function commandFailure(command: string, args: readonly string[], result: CommandResult): Error {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit status ${result.status}`;
    return new Error(`${command} ${args.join(" ")} failed: ${detail}`);
}

function runChecked(
    runner: CommandRunner,
    command: string,
    args: readonly string[],
    cwd: string,
    inherit = false,
): CommandResult {
    const result = runner(command, args, { cwd, inherit });
    if (result.status !== 0) {
        throw commandFailure(command, args, result);
    }
    return result;
}

function normalizeSha(value: string, label: string): string {
    const sha = value.trim().toLowerCase();
    if (!/^[0-9a-f]{40,64}$/.test(sha)) {
        throw new Error(`${label} is not a full commit SHA: ${value || "<empty>"}`);
    }
    return sha;
}

function parseVersionParts(match: RegExpMatchArray): VersionParts {
    return {
        major: Number.parseInt(match[1], 10),
        minor: Number.parseInt(match[2], 10),
        patch: Number.parseInt(match[3], 10),
    };
}

function timestampIsValid(timestamp: string): boolean {
    const match = timestamp.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (!match) {
        return false;
    }
    const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
    const date = new Date(iso);
    return !Number.isNaN(date.valueOf()) && date.toISOString() === iso;
}

export function isSemanticVersion(version: string): boolean {
    const match = version.match(SEMVER_PATTERN);
    if (!match) {
        return false;
    }
    const prerelease = match[4];
    if (!prerelease) {
        return true;
    }
    return prerelease.split(".").every((identifier) => !/^\d+$/.test(identifier) || identifier === "0" || !identifier.startsWith("0"));
}

export function parseReleaseVersion(version: string): ReleaseVersion {
    const stableMatch = version.match(PLAIN_VERSION_PATTERN);
    if (stableMatch) {
        return {
            ...parseVersionParts(stableMatch),
            raw: version,
            prerelease: false,
        };
    }

    const timestampMatch = version.match(TIMESTAMP_VERSION_PATTERN);
    if (timestampMatch && timestampIsValid(timestampMatch[4])) {
        return {
            ...parseVersionParts(timestampMatch),
            raw: version,
            prerelease: true,
            timestamp: timestampMatch[4],
        };
    }

    throw new Error(`Unsupported release version: ${version}`);
}

export function compareReleaseVersions(left: string, right: string): number {
    const a = parseReleaseVersion(left);
    const b = parseReleaseVersion(right);
    for (const key of ["major", "minor", "patch"] as const) {
        if (a[key] !== b[key]) {
            return a[key] < b[key] ? -1 : 1;
        }
    }
    if (a.prerelease !== b.prerelease) {
        return a.prerelease ? -1 : 1;
    }
    if (!a.prerelease) {
        return 0;
    }
    return a.timestamp === b.timestamp ? 0 : (a.timestamp as string) < (b.timestamp as string) ? -1 : 1;
}

export function productionTag(version: string): string {
    const parsed = parseReleaseVersion(version);
    if (parsed.prerelease) {
        throw new Error(`Production tags require a plain semantic version: ${version}`);
    }
    return `v${version}`;
}

export function devTag(version: string, now = new Date()): string {
    productionTag(version);
    const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    return `v${version}-${timestamp}`;
}

export function annotatedTagMessage(tag: string): string {
    const release = parseTag(tag);
    return release.isPrerelease
        ? `Development pre-release (dev) ${tag}\n\nThis is a pre-release for testing purposes.`
        : `Release ${tag}`;
}

export function parseTag(tag: string): Omit<ReleaseContext, "verified" | "targetSha"> {
    if (!tag.startsWith("v")) {
        throw new Error(`Release tag must start with v: ${tag}`);
    }
    const version = tag.slice(1);
    const release = parseReleaseVersion(version);
    const baseVersion = `${release.major}.${release.minor}.${release.patch}`;
    return {
        tag,
        version,
        baseVersion,
        isPrerelease: release.prerelease,
    };
}

export class GitReleaseRepository implements ReleaseRepository {
    public constructor(
        private readonly cwd: string,
        private readonly runner: CommandRunner = defaultCommandRunner,
    ) {}

    private git(args: readonly string[], inherit = false): CommandResult {
        return this.runner("git", args, { cwd: this.cwd, inherit });
    }

    public resolveCommit(ref: string): string {
        const args = ["rev-parse", `${ref}^{commit}`];
        const result = this.git(args);
        if (result.status !== 0) {
            throw commandFailure("git", args, result);
        }
        return normalizeSha(result.stdout, ref);
    }

    public commitExists(ref: string): boolean {
        const args = ["cat-file", "-e", `${ref}^{commit}`];
        const result = this.git(args);
        if (result.status === 0) {
            return true;
        }
        if (result.status === 1 || result.status === 128) {
            return false;
        }
        throw commandFailure("git", args, result);
    }

    public readFileAtCommit(commit: string, file: string): string {
        const args = ["show", `${commit}:${file}`];
        const result = this.git(args);
        if (result.status !== 0) {
            throw commandFailure("git", args, result);
        }
        return result.stdout;
    }

    public localTagTarget(tag: string): string | null {
        const ref = `refs/tags/${tag}`;
        const checkArgs = ["show-ref", "--verify", "--quiet", ref];
        const check = this.git(checkArgs);
        if (check.status === 1) {
            return null;
        }
        if (check.status !== 0) {
            throw commandFailure("git", checkArgs, check);
        }
        return this.resolveCommit(ref);
    }

    private fetchedTagAnnotation(tag: string): TagAnnotation | null {
        const typeArgs = ["cat-file", "-t", "FETCH_HEAD"];
        const typeResult = this.git(typeArgs);
        if (typeResult.status !== 0) {
            throw commandFailure("git", typeArgs, typeResult);
        }
        const objectType = typeResult.stdout.trim();
        if (objectType === "commit") {
            return null;
        }
        if (objectType !== "tag") {
            throw new Error(`Remote tag ${tag} points to unsupported object type ${objectType}`);
        }

        const contentArgs = ["cat-file", "tag", "FETCH_HEAD"];
        const contentResult = this.git(contentArgs);
        if (contentResult.status !== 0) {
            throw commandFailure("git", contentArgs, contentResult);
        }
        const separator = contentResult.stdout.indexOf("\n\n");
        if (separator < 0) {
            throw new Error(`Remote annotated tag ${tag} has malformed content`);
        }
        const headers = contentResult.stdout.slice(0, separator).split("\n");
        if (!headers.includes(`tag ${tag}`)) {
            throw new Error(`Remote annotated tag ${tag} has a mismatched internal tag name`);
        }
        const taggerHeader = headers.find((line) => line.startsWith("tagger "));
        const tagger = taggerHeader?.match(/^tagger (.*) <([^<>]+)> \d+ [+-]\d{4}$/);
        if (!tagger) {
            throw new Error(`Remote annotated tag ${tag} has a malformed tagger identity`);
        }
        return {
            message: contentResult.stdout.slice(separator + 2).replace(/\n+$/, ""),
            taggerName: tagger[1],
            taggerEmail: tagger[2],
        };
    }

    public remoteTag(tag: string): RemoteReleaseTag | null {
        const ref = `refs/tags/${tag}`;
        const lookupArgs = ["ls-remote", "--exit-code", "--refs", "origin", ref];
        const lookup = this.git(lookupArgs);
        if (lookup.status === 2) {
            return null;
        }
        if (lookup.status !== 0) {
            throw commandFailure("git", lookupArgs, lookup);
        }
        const lines = lookup.stdout.trim().split("\n").filter(Boolean);
        if (lines.length !== 1 || !lines[0].endsWith(`\t${ref}`)) {
            throw new Error(`Remote lookup for ${tag} returned ambiguous data`);
        }

        const fetchArgs = ["fetch", "--force", "--no-tags", "origin", ref];
        const fetch = this.git(fetchArgs);
        if (fetch.status !== 0) {
            throw commandFailure("git", fetchArgs, fetch);
        }
        return {
            targetSha: this.resolveCommit("FETCH_HEAD"),
            annotation: this.fetchedTagAnnotation(tag),
        };
    }

    public remoteTagTarget(tag: string): string | null {
        return this.remoteTag(tag)?.targetSha ?? null;
    }

    public createAnnotatedTag(tag: string, message: string, targetSha: string): void {
        runChecked(this.runner, "git", ["tag", "-a", tag, "-m", message, targetSha], this.cwd, true);
    }

    public pushTag(tag: string): boolean {
        const ref = `refs/tags/${tag}`;
        return this.git(["push", "origin", `${ref}:${ref}`], true).status === 0;
    }

    public isClean(): boolean {
        const args = ["status", "--porcelain", "--untracked-files=normal"];
        const result = this.git(args);
        if (result.status !== 0) {
            throw commandFailure("git", args, result);
        }
        return result.stdout.trim() === "";
    }
}

function packageVersionFromContent(content: string, label: string): string {
    let value: unknown;
    try {
        value = JSON.parse(content);
    } catch (error) {
        throw new Error(`Could not parse ${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!value || typeof value !== "object" || typeof (value as Partial<PackageJson>).version !== "string") {
        throw new Error(`${label} does not contain a string version`);
    }
    return (value as PackageJson).version;
}

function assertSemanticVersion(version: string, label: string): void {
    if (!isSemanticVersion(version)) {
        throw new Error(`${label} is malformed: ${version}`);
    }
}

function assertExpectedTarget(actual: string, expected: string, label: string): void {
    if (normalizeSha(actual, label) !== expected) {
        throw new Error(`${label} points to ${actual}, expected ${expected}`);
    }
}

function resolveBeforeCommit(repository: ReleaseRepository, beforeSha: string | undefined): string {
    const supplied = beforeSha?.trim();
    if (supplied && !/^0+$/.test(supplied) && repository.commitExists(supplied)) {
        return repository.resolveCommit(supplied);
    }
    return repository.resolveCommit("HEAD^");
}

function verifiedResult(outcome: AutoTagOutcome, releaseRequired: boolean, tag: string, targetSha: string): AutoTagResult {
    return {
        outcome,
        releaseRequired,
        verified: true,
        tag,
        targetSha,
    };
}

export function isAutomaticReleaseTag(tag: string, remote: RemoteReleaseTag): boolean {
    const annotation = remote.annotation;
    return annotation !== null
        && annotation.message === annotatedTagMessage(tag)
        && annotation.taggerName === AUTOMATIC_RELEASE_TAGGER_NAME
        && annotation.taggerEmail === AUTOMATIC_RELEASE_TAGGER_EMAIL;
}

function inspectExistingTag(
    repository: ReleaseRepository,
    tag: string,
    targetSha: string,
): { local: string | null; remote: RemoteReleaseTag | null } {
    const local = repository.localTagTarget(tag);
    if (local) {
        assertExpectedTarget(local, targetSha, `Local tag ${tag}`);
    }
    const remote = repository.remoteTag(tag);
    if (remote) {
        assertExpectedTarget(remote.targetSha, targetSha, `Remote tag ${tag}`);
    }
    if (local && !remote) {
        throw new Error(`Local tag ${tag} exists but the exact remote tag is absent`);
    }
    return { local, remote };
}

function runVerifiedProductionGate(options: AutomaticReleaseOptions, targetSha: string): void {
    options.runProductionGate();
    if (!options.repository.isClean()) {
        throw new Error("Production gate left uncommitted changes in the working tree");
    }
    assertExpectedTarget(options.repository.resolveCommit("HEAD"), targetSha, "HEAD after production gate");
}

export function runAutomaticRelease(options: AutomaticReleaseOptions): AutoTagResult {
    const targetSha = normalizeSha(options.repository.resolveCommit("HEAD"), "HEAD");
    const githubSha = normalizeSha(options.githubSha, "GITHUB_SHA");
    if (targetSha !== githubSha) {
        throw new Error(`Checked-out HEAD ${targetSha} does not match GITHUB_SHA ${githubSha}`);
    }

    const beforeCommit = resolveBeforeCommit(options.repository, options.beforeSha);
    const previousVersion = packageVersionFromContent(
        options.repository.readFileAtCommit(beforeCommit, "package.json"),
        `package.json at ${beforeCommit}`,
    );
    assertSemanticVersion(previousVersion, "Previous package version");
    assertSemanticVersion(options.currentVersion, "Current package version");

    if (previousVersion === options.currentVersion) {
        return {
            outcome: "no-version-change",
            releaseRequired: false,
            verified: false,
            tag: "",
            targetSha,
        };
    }

    if (!PLAIN_VERSION_PATTERN.test(options.currentVersion)) {
        return {
            outcome: "non-production-version",
            releaseRequired: false,
            verified: false,
            tag: "",
            targetSha,
        };
    }

    const tag = productionTag(options.currentVersion);
    const initial = inspectExistingTag(options.repository, tag, targetSha);
    if (initial.remote) {
        if (!isAutomaticReleaseTag(tag, initial.remote)) {
            return verifiedResult("verified-existing-tag", false, tag, targetSha);
        }

        runVerifiedProductionGate(options, targetSha);
        const recovered = inspectExistingTag(options.repository, tag, targetSha);
        if (!recovered.remote || !isAutomaticReleaseTag(tag, recovered.remote)) {
            throw new Error(`Automatic release tag ${tag} changed during recovery verification`);
        }
        return verifiedResult("verified-recovered-tag", true, tag, targetSha);
    }

    runVerifiedProductionGate(options, targetSha);

    const afterGate = inspectExistingTag(options.repository, tag, targetSha);
    if (afterGate.remote) {
        return verifiedResult("verified-race", true, tag, targetSha);
    }
    if (afterGate.local) {
        throw new Error(`Local tag ${tag} appeared without a verified remote tag`);
    }

    options.repository.createAnnotatedTag(tag, annotatedTagMessage(tag), targetSha);
    const localTarget = options.repository.localTagTarget(tag);
    if (!localTarget) {
        throw new Error(`Created tag ${tag} cannot be resolved locally`);
    }
    assertExpectedTarget(localTarget, targetSha, `Created tag ${tag}`);

    const pushed = options.repository.pushTag(tag);
    const remote = options.repository.remoteTag(tag);
    if (!remote) {
        throw new Error(`Tag push ${pushed ? "reported success" : "failed"}, but remote tag ${tag} is absent`);
    }
    assertExpectedTarget(remote.targetSha, targetSha, `Remote tag ${tag} after push`);

    return verifiedResult(pushed ? "created" : "verified-race", true, tag, targetSha);
}

export function validateReleaseContext(
    repository: ReleaseRepository,
    tag: string,
    packageVersion: string,
    githubSha: string,
): ReleaseContext {
    const parsed = parseTag(tag);
    assertSemanticVersion(packageVersion, "Current package version");
    if (parsed.baseVersion !== packageVersion) {
        throw new Error(`Tag ${tag} does not match package version ${packageVersion}`);
    }

    const targetSha = normalizeSha(repository.resolveCommit("HEAD"), "HEAD");
    const expectedSha = normalizeSha(githubSha, "GITHUB_SHA");
    if (targetSha !== expectedSha) {
        throw new Error(`Checked-out HEAD ${targetSha} does not match GITHUB_SHA ${expectedSha}`);
    }

    const local = repository.localTagTarget(tag);
    if (!local) {
        throw new Error(`Release tag ${tag} is not present locally`);
    }
    assertExpectedTarget(local, targetSha, `Local release tag ${tag}`);
    const remote = repository.remoteTag(tag);
    if (!remote) {
        throw new Error(`Release tag ${tag} is not present on origin`);
    }
    assertExpectedTarget(remote.targetSha, targetSha, `Remote release tag ${tag}`);

    return {
        ...parsed,
        verified: true,
        targetSha,
    };
}

export function runProductionGate(
    repository: ReleaseRepository,
    cwd = projectRoot,
    runner: CommandRunner = defaultCommandRunner,
): void {
    runChecked(runner, "npm", ["run", "version:verify"], cwd, true);
    runChecked(runner, "npm", ["test"], cwd, true);
    if (!repository.isClean()) {
        throw new Error("Full npm test gate left uncommitted changes in the working tree");
    }
}

function readPackage(): PackageJson {
    return JSON.parse(fs.readFileSync(packagePath, "utf8")) as PackageJson;
}

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
    const match = version.match(PLAIN_VERSION_PATTERN);
    if (!match) {
        throw new Error(`Invalid version format: ${version}`);
    }
    return parseVersionParts(match);
}

function formatVersion(version: VersionParts): string {
    return `${version.major}.${version.minor}.${version.patch}`;
}

function bumpVersion(currentVersion: string, bumpType: BumpType): string {
    const version = parseVersion(currentVersion);
    switch (bumpType) {
    case "major":
        version.major++;
        version.minor = 0;
        version.patch = 0;
        break;
    case "minor":
        version.minor++;
        version.patch = 0;
        break;
    case "patch":
        version.patch++;
        break;
    default:
        throw new Error(`Unknown bump type: ${bumpType}`);
    }
    return formatVersion(version);
}

function updatePackageVersion(pkg: PackageJson, newVersion: string): void {
    pkg.version = newVersion;
    fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log(`✅ Updated package.json to version ${newVersion}`);
}

function updatePyprojectVersion(newVersion: string): void {
    let content = fs.readFileSync(pyprojectPath, "utf8");
    content = content.replace(/^version\s*=\s*"[^"]+"/m, `version = "${newVersion}"`);
    fs.writeFileSync(pyprojectPath, content);
    console.log(`✅ Updated docker/pyproject.toml to version ${newVersion}`);

    const result = defaultCommandRunner("uv", ["sync"], { cwd: path.join(projectRoot, "docker"), inherit: true });
    if (result.status !== 0) {
        console.error("⚠️  Warning: Failed to run uv sync; run it manually in docker/");
    } else {
        console.log("✅ Updated docker/uv.lock");
    }
}

function updateAppManifestVersion(newVersion: string): void {
    let content = fs.readFileSync(appManifestPath, "utf8");
    content = content.replace(/^(\s*)version:\s*.+$/m, `$1version: ${newVersion}`);
    fs.writeFileSync(appManifestPath, content);
    console.log(`✅ Updated docker/app-manifest.yaml to version ${newVersion}`);
}

function writeActionsOutputs(values: Record<string, string | boolean>): void {
    const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value)}\n`).join("");
    const outputPath = process.env.GITHUB_OUTPUT;
    if (outputPath) {
        fs.appendFileSync(outputPath, lines);
    }
    console.log(lines.trim());
}

function createManualTag(repository: ReleaseRepository, version: string, isDev: boolean, noPush: boolean): string {
    const tag = isDev ? devTag(version) : productionTag(version);
    if (!repository.isClean()) {
        throw new Error("You have uncommitted changes");
    }
    if (repository.localTagTarget(tag)) {
        throw new Error(`Tag ${tag} already exists locally`);
    }
    if (repository.remoteTag(tag)) {
        throw new Error(`Tag ${tag} already exists on origin`);
    }

    const targetSha = repository.resolveCommit("HEAD");
    repository.createAnnotatedTag(tag, annotatedTagMessage(tag), targetSha);
    if (noPush) {
        console.log(`✅ Created ${tag}; push later with: git push origin ${tag}`);
        return tag;
    }

    const pushed = repository.pushTag(tag);
    const remote = repository.remoteTag(tag);
    if (!remote) {
        throw new Error(`Failed to push tag ${tag}; the exact remote tag is absent`);
    }
    assertExpectedTarget(remote.targetSha, normalizeSha(targetSha, "HEAD"), `Remote tag ${tag}`);
    console.log(`✅ ${pushed ? "Pushed" : "Verified concurrent push of"} tag ${tag}`);
    return tag;
}

function printHelp(pkg: PackageJson): void {
    console.log(`Current version: ${pkg.version}\n`);
    console.log("Usage: npm run version -- [command] [options]\n");
    console.log("Version commands: major, minor, patch, sync");
    console.log("Release commands: tag [dev] [--no-push], auto-tag, release-context");
    console.log("Verification command: verify-clean-git");
}

export function main(args = process.argv.slice(2)): number {
    const pkg = readPackage();
    const repository = new GitReleaseRepository(projectRoot);
    const command = args[0];

    try {
        if (!command) {
            const tomlVersion = readPyprojectVersion();
            const yamlVersion = readAppManifestVersion();
            console.log("Version files:");
            console.log(`  package.json:              ${pkg.version}`);
            console.log(`  docker/pyproject.toml:     ${tomlVersion}`);
            console.log(`  docker/app-manifest.yaml:  ${yamlVersion}`);
            console.log(pkg.version === tomlVersion && pkg.version === yamlVersion
                ? "\n✅ All versions are in sync"
                : "\n⚠️  Versions are out of sync! Run npm run version -- sync to fix.");
            return 0;
        }

        if (args.includes("--help") || args.includes("-h")) {
            printHelp(pkg);
            return 0;
        }

        if (command === "verify-clean-git") {
            if (!repository.isClean()) {
                throw new Error("You have uncommitted changes");
            }
            console.log("✅ Git working directory is clean");
            return 0;
        }

        if (command === "auto-tag") {
            try {
                const result = runAutomaticRelease({
                    repository,
                    currentVersion: pkg.version,
                    beforeSha: process.env.GITHUB_EVENT_BEFORE,
                    githubSha: process.env.GITHUB_SHA ?? "",
                    runProductionGate: () => runProductionGate(repository),
                });
                writeActionsOutputs({
                    outcome: result.outcome,
                    release_required: result.releaseRequired,
                    verified: result.verified,
                    tag: result.tag,
                    target_sha: result.targetSha,
                });
                return 0;
            } catch (error) {
                writeActionsOutputs({
                    outcome: "failure",
                    release_required: false,
                    verified: false,
                    tag: "",
                    target_sha: "",
                });
                throw error;
            }
        }

        if (command === "release-context") {
            const tag = args[1] ?? process.env.RELEASE_TAG ?? "";
            const context = validateReleaseContext(repository, tag, pkg.version, process.env.GITHUB_SHA ?? "");
            writeActionsOutputs({
                verified: context.verified,
                tag: context.tag,
                version: context.version,
                base_version: context.baseVersion,
                target_sha: context.targetSha,
                is_prerelease: context.isPrerelease,
            });
            return 0;
        }

        if (command === "sync") {
            updatePyprojectVersion(pkg.version);
            updateAppManifestVersion(pkg.version);
            const diff = defaultCommandRunner(
                "git",
                ["diff", "--quiet", "docker/pyproject.toml", "docker/app-manifest.yaml", "docker/uv.lock"],
                { cwd: projectRoot },
            );
            if (diff.status !== 0) {
                runChecked(defaultCommandRunner, "git", ["add", "docker/pyproject.toml", "docker/app-manifest.yaml", "docker/uv.lock"], projectRoot, true);
                runChecked(defaultCommandRunner, "git", ["commit", "-m", `chore: sync versions to ${pkg.version}`], projectRoot, true);
            }
            return 0;
        }

        if (command === "tag") {
            createManualTag(repository, pkg.version, args.includes("dev"), args.includes("--no-push"));
            return 0;
        }

        if (!repository.isClean()) {
            throw new Error("You have uncommitted changes");
        }
        const newVersion = bumpVersion(pkg.version, command as BumpType);
        console.log(`Bumping version: ${pkg.version} -> ${newVersion}`);
        updatePackageVersion(pkg, newVersion);
        updatePyprojectVersion(newVersion);
        updateAppManifestVersion(newVersion);
        runChecked(defaultCommandRunner, "git", ["add", "package.json", "docker/pyproject.toml", "docker/app-manifest.yaml", "docker/uv.lock"], projectRoot, true);
        runChecked(defaultCommandRunner, "git", ["commit", "-m", `chore: bump version to ${newVersion}`], projectRoot, true);
        return 0;
    } catch (error) {
        console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

if (require.main === module) {
    process.exitCode = main();
}
