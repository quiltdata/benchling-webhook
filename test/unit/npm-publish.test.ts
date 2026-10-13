import {
    CliNpmRegistry,
    NpmRegistry,
    parkingDistTag,
    publishRelease,
} from "../../scripts/npm-publish";

const PACKAGE = "@quiltdata/benchling-webhook";

/** Models npm trusted publishing: only `publish` is available, and it sets one dist-tag. */
class FakeRegistry implements NpmRegistry {
    public readonly versionSet = new Set<string>();
    public readonly tags: Record<string, string> = {};
    public readonly calls: string[] = [];
    public failVersions = false;
    public failTags = false;
    public failPublish = false;

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
}

describe("retry-safe npm release publication", () => {
    it("publishes a missing version directly to an empty latest channel", () => {
        const registry = new FakeRegistry("1.2.3");

        const result = publishRelease(registry, PACKAGE, "1.2.3", "1.2.3");

        expect(result).toEqual({ immutableCreated: true, channel: "latest", promotion: "initialized" });
        expect(registry.calls).toEqual(["versions", "dist-tags", "publish:latest"]);
        expect(registry.tags.latest).toBe("1.2.3");
    });

    it("publishes a newer production version atomically under latest", () => {
        const registry = new FakeRegistry("1.2.3");
        registry.tags.latest = "1.2.2";

        const result = publishRelease(registry, PACKAGE, "1.2.3", "1.2.3");

        expect(result.promotion).toBe("promoted");
        expect(registry.calls).toContain("publish:latest");
        expect(registry.tags.latest).toBe("1.2.3");
    });

    it("parks a stale candidate under a per-version tag without moving latest", () => {
        const registry = new FakeRegistry("2.0.0");
        publishRelease(registry, PACKAGE, "2.0.0", "2.0.0");
        registry.candidate = "1.9.0";

        const older = publishRelease(registry, PACKAGE, "1.9.0", "1.9.0");

        expect(older).toEqual({ immutableCreated: true, channel: "latest", promotion: "stale" });
        expect(registry.calls).toContain(`publish:${parkingDistTag("1.9.0")}`);
        expect(registry.versionSet).toEqual(new Set(["2.0.0", "1.9.0"]));
        expect(registry.tags.latest).toBe("2.0.0");
    });

    it.each([
        ["equal", "1.2.3", "current"],
        ["stale", "1.2.4", "stale"],
    ])("treats an already-published %s version as a successful retry", (_label, current, expected) => {
        const registry = new FakeRegistry("1.2.3");
        registry.versionSet.add("1.2.3");
        registry.tags.latest = current;

        const result = publishRelease(registry, PACKAGE, "1.2.3", "1.2.3");

        expect(result).toEqual({ immutableCreated: false, channel: "latest", promotion: expected });
        expect(registry.calls.some((call) => call.startsWith("publish:"))).toBe(false);
        expect(registry.tags.latest).toBe(current);
    });

    it("fails closed when an already-published version still needs a dist-tag move", () => {
        const registry = new FakeRegistry("1.2.3");
        registry.versionSet.add("1.2.3");
        registry.tags.latest = "1.2.2";

        expect(() => publishRelease(registry, PACKAGE, "1.2.3", "1.2.3"))
            .toThrow(`npm dist-tag add ${PACKAGE}@1.2.3 latest`);
        expect(registry.tags.latest).toBe("1.2.2");
    });

    it("publishes timestamp prereleases to a guarded dev channel", () => {
        const version = "1.2.3-20261012T212246Z";
        const registry = new FakeRegistry(version);
        registry.tags.dev = "1.2.3-20261012T202246Z";
        registry.tags.latest = "1.2.2";

        const result = publishRelease(registry, PACKAGE, version, version);

        expect(result.channel).toBe("dev");
        expect(result.promotion).toBe("promoted");
        expect(registry.tags.dev).toBe(version);
        expect(registry.tags.latest).toBe("1.2.2");
    });

    it.each([
        ["version lookup", (registry: FakeRegistry) => { registry.failVersions = true; }, "version lookup failed"],
        ["dist-tag lookup", (registry: FakeRegistry) => { registry.failTags = true; }, "dist-tag lookup failed"],
        ["publish", (registry: FakeRegistry) => { registry.failPublish = true; }, "publish failed"],
    ])("fails closed on %s errors", (_label, configure, message) => {
        const registry = new FakeRegistry("1.2.3");
        configure(registry);
        expect(() => publishRelease(registry, PACKAGE, "1.2.3", "1.2.3")).toThrow(message);
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
