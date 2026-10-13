import {
    CliNpmRegistry,
    NpmRegistry,
    publishRelease,
    temporaryDistTag,
} from "../../scripts/npm-publish";

const PACKAGE = "@quiltdata/benchling-webhook";

class FakeRegistry implements NpmRegistry {
    public readonly versionSet = new Set<string>();
    public readonly tags: Record<string, string> = {};
    public readonly calls: string[] = [];
    public failVersions = false;
    public failTags = false;
    public failPublish = false;
    public failPromotion = false;
    public failCleanup = false;

    public constructor(public candidate: string) {}

    public versions(): string[] {
        this.calls.push("versions");
        if (this.failVersions) {
            throw new Error("version lookup failed");
        }
        return [...this.versionSet];
    }

    public distTags(): Record<string, string> {
        this.calls.push("dist-tags");
        if (this.failTags) {
            throw new Error("dist-tag lookup failed");
        }
        return { ...this.tags };
    }

    public publish(tag: string): void {
        this.calls.push(`publish:${tag}`);
        if (this.failPublish) {
            throw new Error("publish failed");
        }
        this.versionSet.add(this.candidate);
        this.tags[tag] = this.candidate;
    }

    public setDistTag(_packageName: string, version: string, tag: string): void {
        this.calls.push(`promote:${tag}:${version}`);
        if (this.failPromotion) {
            throw new Error("promotion failed");
        }
        this.tags[tag] = version;
    }

    public removeDistTag(_packageName: string, tag: string): void {
        this.calls.push(`cleanup:${tag}`);
        if (this.failCleanup) {
            throw new Error("cleanup failed");
        }
        delete this.tags[tag];
    }
}

describe("retry-safe npm release publication", () => {
    it("publishes a missing immutable version under a temporary tag and initializes latest", () => {
        const registry = new FakeRegistry("1.2.3");

        const result = publishRelease(registry, PACKAGE, "1.2.3", "1.2.3");

        expect(result).toEqual({ immutableCreated: true, channel: "latest", promotion: "initialized" });
        expect(registry.versionSet).toContain("1.2.3");
        expect(registry.tags.latest).toBe("1.2.3");
        expect(registry.tags[temporaryDistTag("1.2.3")]).toBeUndefined();
    });

    it("recovers an existing version and stale temporary tag after a partial failure", () => {
        const registry = new FakeRegistry("1.2.3");
        registry.versionSet.add("1.2.3");
        registry.tags[temporaryDistTag("1.2.3")] = "1.2.3";
        registry.tags.latest = "1.2.2";

        const result = publishRelease(registry, PACKAGE, "1.2.3", "1.2.3");

        expect(result).toEqual({ immutableCreated: false, channel: "latest", promotion: "promoted" });
        expect(registry.calls.some((call) => call.startsWith("publish:"))).toBe(false);
        expect(registry.tags.latest).toBe("1.2.3");
        expect(registry.tags[temporaryDistTag("1.2.3")]).toBeUndefined();
    });

    it.each([
        ["newer", "1.2.2", "promoted", true],
        ["equal", "1.2.3", "current", false],
        ["stale", "1.2.4", "stale", false],
    ])("handles a %s production candidate monotonically", (_label, current, expected, promoted) => {
        const registry = new FakeRegistry("1.2.3");
        registry.versionSet.add("1.2.3");
        registry.tags.latest = current;

        const result = publishRelease(registry, PACKAGE, "1.2.3", "1.2.3");

        expect(result.promotion).toBe(expected);
        expect(registry.calls.some((call) => call.startsWith("promote:latest"))).toBe(promoted);
        expect(registry.tags.latest).toBe(promoted ? "1.2.3" : current);
    });

    it("publishes timestamp prereleases to a guarded dev channel", () => {
        const version = "1.2.3-20261012T212246Z";
        const registry = new FakeRegistry(version);
        registry.tags.dev = "1.2.3-20261012T202246Z";

        const result = publishRelease(registry, PACKAGE, version, version);

        expect(result.channel).toBe("dev");
        expect(result.promotion).toBe("promoted");
        expect(registry.tags.dev).toBe(version);
    });

    it("leaves latest on a newer release when an older publisher runs second", () => {
        const registry = new FakeRegistry("2.0.0");
        publishRelease(registry, PACKAGE, "2.0.0", "2.0.0");
        registry.candidate = "1.9.0";

        const older = publishRelease(registry, PACKAGE, "1.9.0", "1.9.0");

        expect(older.promotion).toBe("stale");
        expect(registry.versionSet).toEqual(new Set(["2.0.0", "1.9.0"]));
        expect(registry.tags.latest).toBe("2.0.0");
    });

    it("retries after promotion and cleanup partial failures without moving latest backward", () => {
        const registry = new FakeRegistry("1.2.3");
        registry.tags.latest = "1.2.2";
        registry.failCleanup = true;
        expect(() => publishRelease(registry, PACKAGE, "1.2.3", "1.2.3")).toThrow("cleanup failed");
        expect(registry.tags.latest).toBe("1.2.3");

        registry.failCleanup = false;
        expect(publishRelease(registry, PACKAGE, "1.2.3", "1.2.3").promotion).toBe("current");
        expect(registry.tags[temporaryDistTag("1.2.3")]).toBeUndefined();
    });

    it.each([
        ["version lookup", (registry: FakeRegistry) => { registry.failVersions = true; }, "version lookup failed"],
        ["dist-tag lookup", (registry: FakeRegistry) => { registry.failTags = true; }, "dist-tag lookup failed"],
        ["publish", (registry: FakeRegistry) => { registry.failPublish = true; }, "publish failed"],
        ["promotion", (registry: FakeRegistry) => { registry.failPromotion = true; }, "promotion failed"],
        ["cleanup", (registry: FakeRegistry) => { registry.failCleanup = true; }, "cleanup failed"],
    ])("fails closed on %s errors", (_label, configure, message) => {
        const registry = new FakeRegistry("1.2.3");
        configure(registry);
        expect(() => publishRelease(registry, PACKAGE, "1.2.3", "1.2.3")).toThrow(message);
    });

    it("attempts temporary-tag cleanup after promotion failure", () => {
        const registry = new FakeRegistry("1.2.3");
        registry.failPromotion = true;

        expect(() => publishRelease(registry, PACKAGE, "1.2.3", "1.2.3")).toThrow("promotion failed");
        expect(registry.calls).toContain(`cleanup:${temporaryDistTag("1.2.3")}`);
    });

    it("rejects malformed latest state and package-version mismatch", () => {
        const registry = new FakeRegistry("1.2.3");
        registry.versionSet.add("1.2.3");
        registry.tags.latest = "banana";
        expect(() => publishRelease(registry, PACKAGE, "1.2.3", "1.2.3")).toThrow("Unsupported release version");
        expect(() => publishRelease(registry, PACKAGE, "1.2.3", "1.2.2")).toThrow("does not match");
    });
});

describe("npm CLI response validation", () => {
    it("rejects malformed registry JSON", () => {
        const registry = new CliNpmRegistry(() => ({ status: 0, stdout: "not-json", stderr: "" }));
        expect(() => registry.versions(PACKAGE)).toThrow("Malformed npm versions response");
    });

    it("fails a registry command error instead of treating the version as absent", () => {
        const registry = new CliNpmRegistry(() => ({ status: 1, stdout: "", stderr: "network unavailable" }));
        expect(() => registry.versions(PACKAGE)).toThrow("network unavailable");
    });
});
