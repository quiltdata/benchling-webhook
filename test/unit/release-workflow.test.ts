import * as fs from "fs";
import * as path from "path";

const workflow = fs.readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", "ci.yaml"), "utf8");
const publishSection = workflow.split("\n  publish:\n")[1] ?? "";
const autoTagSection = workflow.split("\n  autotag:\n")[1]?.split("\n  publish:\n")[0] ?? "";

interface Eligibility {
    cancelled: boolean;
    test: "success" | "failure" | "cancelled";
    autoTag: "success" | "failure" | "skipped";
    directTag: boolean;
    releaseRequired?: boolean;
    verified?: boolean;
    tag?: string;
}

function eligible(input: Eligibility): boolean {
    return !input.cancelled
        && input.test === "success"
        && (input.autoTag === "success" || input.autoTag === "skipped")
        && (input.directTag || (
            input.releaseRequired === true
            && input.verified === true
            && Boolean(input.tag)
        ));
}

describe("release workflow safety predicates", () => {
    it.each([
        ["direct tag", { cancelled: false, test: "success", autoTag: "skipped", directTag: true }, true],
        ["automatic tag", {
            cancelled: false,
            test: "success",
            autoTag: "success",
            directTag: false,
            releaseRequired: true,
            verified: true,
            tag: "v1.2.3",
        }, true],
        ["unchanged main", { cancelled: false, test: "success", autoTag: "success", directTag: false }, false],
        ["failed test", { cancelled: false, test: "failure", autoTag: "skipped", directTag: true }, false],
        ["skipped autotag on main", { cancelled: false, test: "success", autoTag: "skipped", directTag: false }, false],
        ["failed autotag", { cancelled: false, test: "success", autoTag: "failure", directTag: false }, false],
        ["canceled run", { cancelled: true, test: "success", autoTag: "success", directTag: true }, false],
    ] as const)("makes %s eligibility %s", (_label, input, expected) => {
        expect(eligible(input)).toBe(expected);
    });

    it("contains the cancellation-aware, result-aware condition represented by the table", () => {
        const compact = publishSection.replace(/\s+/g, " ");
        expect(compact).toContain("!cancelled()");
        expect(compact).toContain("needs.test.result == 'success'");
        expect(compact).toContain("needs.autotag.result == 'success' || needs.autotag.result == 'skipped'");
        expect(compact).toContain("needs.autotag.outputs.release_required == 'true'");
        expect(compact).toContain("needs.autotag.outputs.verified == 'true'");
        expect(compact).not.toContain("always()");
    });

    it("holds every irreversible phase in one non-canceling concurrency group", () => {
        expect(publishSection).toContain("group: production-release-publication");
        expect(publishSection).toContain("cancel-in-progress: false");
        expect(publishSection).toContain("make ensure-ci-immutable");
        expect(publishSection).not.toContain("make push-ci-immutable");
        expect(publishSection).toContain("make promote-ci");
        expect(publishSection).toContain("uses: softprops/action-gh-release@v3");
        expect(publishSection).toContain("run: npm run release:publish");
        expect(publishSection.match(/if: \$\{\{ !cancelled\(\) && success\(\) }}/g)?.length).toBeGreaterThanOrEqual(7);
    });

    it("routes tag selection and verification through project-owned commands", () => {
        expect(autoTagSection).toContain("run: npm run version:tag:auto");
        expect(autoTagSection).toContain("GIT_COMMITTER_NAME: github-actions[bot]");
        expect(autoTagSection).toContain("41898282+github-actions[bot]@users.noreply.github.com");
        expect(autoTagSection).not.toMatch(/git tag|git push|jq -r|\[\[.*VERSION/);
        expect(publishSection).toContain("run: npm run release:context");
    });
});
