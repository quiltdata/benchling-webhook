import { normalizeBenchlingTenant } from "../../lib/utils/benchling";

describe("normalizeBenchlingTenant", () => {
    test("accepts bare tenant slugs", () => {
        expect(normalizeBenchlingTenant("quilt-dtt")).toBe("quilt-dtt");
    });

    test("normalizes full hostnames", () => {
        expect(normalizeBenchlingTenant("quilt-dtt.benchling.com")).toBe("quilt-dtt");
    });

    test("normalizes full urls", () => {
        expect(normalizeBenchlingTenant("https://quilt-dtt.benchling.com")).toBe("quilt-dtt");
    });

    test("strips trailing dots and paths", () => {
        expect(normalizeBenchlingTenant("https://quilt-dtt.benchling.com/path/ignored.")).toBe("quilt-dtt");
    });
});
