import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import {
    annotatedTagMessage,
    AUTOMATIC_RELEASE_TAGGER_EMAIL,
    AUTOMATIC_RELEASE_TAGGER_NAME,
    compareReleaseVersions,
    devTag,
    GitReleaseRepository,
    ReleaseRepository,
    runAutomaticRelease,
    runProductionGate,
    validateReleaseContext,
} from "../../scripts/version";

const TARGET = "a".repeat(40);
const BEFORE = "b".repeat(40);
const OTHER = "c".repeat(40);

type PushMode = "success" | "success-lookup-error" | "failure" | "race" | "mismatch" | "lookup-error";

class FakeRepository implements ReleaseRepository {
    public readonly localTags = new Map<string, string>();
    public readonly localMessages = new Map<string, string>();
    public readonly remoteTags = new Map<string, string>();
    public readonly remoteAnnotations = new Map<string, {
        message: string;
        taggerName: string;
        taggerEmail: string;
    }>();
    public readonly files = new Map<string, string>();
    public readonly created: string[] = [];
    public pushMode: PushMode = "success";
    public clean = true;
    public parentAvailable = true;
    public pushAttempted = false;
    public postPushLookupFailed = false;

    public constructor(previousVersion = "1.2.2") {
        this.files.set(`${BEFORE}:package.json`, JSON.stringify({ version: previousVersion }));
    }

    public resolveCommit(ref: string): string {
        if (ref === "HEAD") {
            return TARGET;
        }
        if (ref === "HEAD^") {
            if (!this.parentAvailable) {
                throw new Error("HEAD has no parent");
            }
            return BEFORE;
        }
        if (ref === BEFORE || ref === TARGET || ref === OTHER) {
            return ref;
        }
        throw new Error(`Unknown ref ${ref}`);
    }

    public commitExists(ref: string): boolean {
        return ref === BEFORE || ref === TARGET || ref === OTHER;
    }

    public readFileAtCommit(commit: string, file: string): string {
        const content = this.files.get(`${commit}:${file}`);
        if (!content) {
            throw new Error(`Missing ${file} at ${commit}`);
        }
        return content;
    }

    public localTagTarget(tag: string): string | null {
        return this.localTags.get(tag) ?? null;
    }

    public remoteTag(tag: string) {
        if (this.pushAttempted && this.pushMode === "lookup-error") {
            throw new Error("remote lookup failed");
        }
        if (this.pushAttempted && this.pushMode === "success-lookup-error" && !this.postPushLookupFailed) {
            this.postPushLookupFailed = true;
            throw new Error("post-push remote lookup failed");
        }
        const targetSha = this.remoteTags.get(tag);
        if (!targetSha) {
            return null;
        }
        return {
            targetSha,
            annotation: this.remoteAnnotations.get(tag) ?? null,
        };
    }

    public createAnnotatedTag(tag: string, message: string, targetSha: string): void {
        expect(message).toBe(annotatedTagMessage(tag));
        this.created.push(tag);
        this.localTags.set(tag, targetSha);
        this.localMessages.set(tag, message);
    }

    public pushTag(tag: string): boolean {
        this.pushAttempted = true;
        if (this.pushMode === "success" || this.pushMode === "success-lookup-error") {
            this.remoteTags.set(tag, TARGET);
            this.remoteAnnotations.set(tag, {
                message: this.localMessages.get(tag) ?? "",
                taggerName: AUTOMATIC_RELEASE_TAGGER_NAME,
                taggerEmail: AUTOMATIC_RELEASE_TAGGER_EMAIL,
            });
            return true;
        }
        if (this.pushMode === "race") {
            this.remoteTags.set(tag, TARGET);
        } else if (this.pushMode === "mismatch") {
            this.remoteTags.set(tag, OTHER);
        }
        return false;
    }

    public isClean(): boolean {
        return this.clean;
    }
}

function runAuto(repository: FakeRepository, currentVersion = "1.2.3", beforeSha: string | undefined = BEFORE) {
    const gate = jest.fn();
    const result = runAutomaticRelease({
        repository,
        currentVersion,
        beforeSha,
        githubSha: TARGET,
        runProductionGate: gate,
    });
    return { result, gate };
}

describe("automatic release tagging", () => {
    it("returns an explicit no-version-change outcome without tag operations", () => {
        const repository = new FakeRepository("1.2.3");

        const { result, gate } = runAuto(repository);

        expect(result).toMatchObject({
            outcome: "no-version-change",
            releaseRequired: false,
            verified: false,
            tag: "",
            targetSha: TARGET,
        });
        expect(gate).not.toHaveBeenCalled();
        expect(repository.created).toEqual([]);
    });

    it("creates only the production package tag at the intended commit", () => {
        const repository = new FakeRepository();

        const { result, gate } = runAuto(repository);

        expect(gate).toHaveBeenCalledTimes(1);
        expect(repository.created).toEqual(["v1.2.3"]);
        expect(repository.localTags.get("v1.2.3")).toBe(TARGET);
        expect(repository.remoteTags.get("v1.2.3")).toBe(TARGET);
        expect(result).toEqual({
            outcome: "created",
            releaseRequired: true,
            verified: true,
            tag: "v1.2.3",
            targetSha: TARGET,
        });
    });

    it("fails closed on a generic tag push failure", () => {
        const repository = new FakeRepository();
        repository.pushMode = "failure";

        expect(() => runAuto(repository)).toThrow("remote tag v1.2.3 is absent");
        expect(repository.remoteTags.has("v1.2.3")).toBe(false);
    });

    it("recovers an automatic tag after post-push verification failed", () => {
        const repository = new FakeRepository();
        repository.pushMode = "success-lookup-error";

        expect(() => runAuto(repository)).toThrow("post-push remote lookup failed");
        expect(repository.remoteTags.get("v1.2.3")).toBe(TARGET);

        const { result, gate } = runAuto(repository);

        expect(gate).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
            outcome: "verified-recovered-tag",
            releaseRequired: true,
            verified: true,
            tag: "v1.2.3",
            targetSha: TARGET,
        });
    });

    it("accepts only a freshly verified exact push race", () => {
        const repository = new FakeRepository();
        repository.pushMode = "race";

        const { result } = runAuto(repository);

        expect(result).toMatchObject({
            outcome: "verified-race",
            releaseRequired: true,
            verified: true,
            tag: "v1.2.3",
        });
    });

    it.each([
        ["different commit", "mismatch" as const, "expected"],
        ["missing peeled target", "lookup-error" as const, "remote lookup failed"],
    ])("rejects a push race with %s", (_label, mode, message) => {
        const repository = new FakeRepository();
        repository.pushMode = mode;

        expect(() => runAuto(repository)).toThrow(message);
    });

    it("rejects a remote lookup failure before tagging", () => {
        const repository = new FakeRepository();
        repository.remoteTag = () => {
            throw new Error("origin unavailable");
        };

        expect(() => runAuto(repository)).toThrow("origin unavailable");
        expect(repository.created).toEqual([]);
    });

    it("accepts an existing manual tag only at the intended commit", () => {
        const repository = new FakeRepository();
        repository.remoteTags.set("v1.2.3", TARGET);
        repository.remoteAnnotations.set("v1.2.3", {
            message: annotatedTagMessage("v1.2.3"),
            taggerName: "Release Maintainer",
            taggerEmail: "release@example.invalid",
        });

        const { result, gate } = runAuto(repository);

        expect(result).toMatchObject({
            outcome: "verified-existing-tag",
            releaseRequired: false,
            verified: true,
            tag: "v1.2.3",
        });
        expect(gate).not.toHaveBeenCalled();
    });

    it("rejects an existing manual tag at another commit", () => {
        const repository = new FakeRepository();
        repository.remoteTags.set("v1.2.3", OTHER);

        expect(() => runAuto(repository)).toThrow("expected");
    });

    it("uses the first-push fallback for an absent or unavailable before commit", () => {
        const missingPayload = runAuto(new FakeRepository(), "1.2.3", undefined).result;
        const unavailablePayload = runAuto(new FakeRepository(), "1.2.3", "d".repeat(40)).result;

        expect(missingPayload.outcome).toBe("created");
        expect(unavailablePayload.outcome).toBe("created");
    });

    it("fails when fallback history is unavailable", () => {
        const repository = new FakeRepository();
        repository.parentAvailable = false;

        expect(() => runAutomaticRelease({
            repository,
            currentVersion: "1.2.3",
            beforeSha: undefined,
            githubSha: TARGET,
            runProductionGate: jest.fn(),
        })).toThrow("HEAD has no parent");
    });

    it("distinguishes valid non-production versions from malformed versions", () => {
        expect(runAuto(new FakeRepository(), "1.2.3-beta.1").result).toMatchObject({
            outcome: "non-production-version",
            releaseRequired: false,
        });
        expect(() => runAuto(new FakeRepository(), "1.2")).toThrow("malformed");
    });

    it("requires GITHUB_SHA to identify the checked-out commit", () => {
        const repository = new FakeRepository();
        expect(() => runAutomaticRelease({
            repository,
            currentVersion: "1.2.3",
            beforeSha: BEFORE,
            githubSha: OTHER,
            runProductionGate: jest.fn(),
        })).toThrow("does not match GITHUB_SHA");
    });
});

describe("shared release context and gate", () => {
    it("validates direct stable and timestamp tags against local and remote targets", () => {
        for (const tag of ["v1.2.3", "v1.2.3-20261012T212246Z"]) {
            const repository = new FakeRepository();
            repository.localTags.set(tag, TARGET);
            repository.remoteTags.set(tag, TARGET);

            const context = validateReleaseContext(repository, tag, "1.2.3", TARGET);

            expect(context.verified).toBe(true);
            expect(context.targetSha).toBe(TARGET);
            expect(context.isPrerelease).toBe(tag.includes("-"));
        }
    });

    it("rejects a tag/package mismatch", () => {
        const repository = new FakeRepository();
        repository.localTags.set("v1.2.4", TARGET);
        repository.remoteTags.set("v1.2.4", TARGET);
        expect(() => validateReleaseContext(repository, "v1.2.4", "1.2.3", TARGET)).toThrow("does not match");
    });

    it("runs clean verification and the full npm test suite", () => {
        const repository = new FakeRepository();
        const calls: string[] = [];
        runProductionGate(repository, "/repo", (command, args) => {
            calls.push([command, ...args].join(" "));
            return { status: 0, stdout: "", stderr: "" };
        });
        expect(calls).toEqual(["npm run version:verify", "npm test"]);
    });

    it("fetches and dereferences an exact annotated tag from a local test remote", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "version-release-"));
        const remote = path.join(root, "remote.git");
        const checkout = path.join(root, "checkout");
        const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, {
            cwd,
            encoding: "utf8",
        }).trim();

        try {
            fs.mkdirSync(checkout);
            git(root, "init", "--bare", remote);
            git(checkout, "init");
            git(checkout, "config", "user.name", AUTOMATIC_RELEASE_TAGGER_NAME);
            git(checkout, "config", "user.email", AUTOMATIC_RELEASE_TAGGER_EMAIL);
            git(checkout, "config", "commit.gpgsign", "false");
            git(checkout, "config", "tag.gpgsign", "false");
            fs.writeFileSync(path.join(checkout, "package.json"), JSON.stringify({ version: "1.2.3" }));
            git(checkout, "add", "package.json");
            git(checkout, "commit", "-m", "fixture");
            const target = git(checkout, "rev-parse", "HEAD");
            git(checkout, "remote", "add", "origin", remote);
            git(checkout, "tag", "-a", "v1.2.3", "-m", "Release v1.2.3");
            git(checkout, "push", "origin", "refs/tags/v1.2.3:refs/tags/v1.2.3");

            const repository = new GitReleaseRepository(checkout);
            expect(repository.remoteTag("v1.2.3")).toEqual({
                targetSha: target,
                annotation: {
                    message: "Release v1.2.3",
                    taggerName: AUTOMATIC_RELEASE_TAGGER_NAME,
                    taggerEmail: AUTOMATIC_RELEASE_TAGGER_EMAIL,
                },
            });
            expect(repository.remoteTagTarget("v1.2.3")).toBe(target);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("keeps timestamped dev tags and stable-over-prerelease ordering", () => {
        expect(devTag("1.2.3", new Date("2026-10-12T21:22:46.000Z"))).toBe("v1.2.3-20261012T212246Z");
        expect(compareReleaseVersions("1.2.3", "1.2.3-20261012T212246Z")).toBeGreaterThan(0);
        expect(compareReleaseVersions("1.2.3-20261012T212247Z", "1.2.3-20261012T212246Z")).toBeGreaterThan(0);
    });
});
