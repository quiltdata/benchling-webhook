import {
    BUCKETLESS_WARNING,
    VERIFICATION_OFF_WARNING,
    isVerificationOff,
    printRiskyConfigWarnings,
    riskyConfigWarnings,
} from "../lib/utils/risky-config-warnings";

describe("risky configuration warnings", () => {
    it("is silent for a bucket with verification on", () => {
        expect(riskyConfigWarnings({ bucket: "my-bucket", enableVerification: true })).toEqual([]);
        expect(riskyConfigWarnings({ bucket: "my-bucket" })).toEqual([]);
        expect(riskyConfigWarnings({ bucket: "my-bucket", enableVerification: "true" })).toEqual([]);
    });

    it.each([undefined, null, "", "   "])("warns about bucketless mode for bucket %p", (bucket) => {
        expect(riskyConfigWarnings({ bucket, enableVerification: true })).toEqual([BUCKETLESS_WARNING]);
    });

    it.each([false, "false", "FALSE", "0", " false "])("warns when verification is %p", (value) => {
        expect(isVerificationOff(value)).toBe(true);
        expect(riskyConfigWarnings({ bucket: "b", enableVerification: value })).toEqual([VERIFICATION_OFF_WARNING]);
    });

    it.each([true, "true", "1", undefined, null])("treats verification %p as on", (value) => {
        expect(isVerificationOff(value)).toBe(false);
    });

    it("prints both, boxed, with the consequence spelled out", () => {
        const printed: string[] = [];
        const count = printRiskyConfigWarnings({ bucket: "", enableVerification: false }, (m) => printed.push(m));
        expect(count).toBe(2);
        const text = printed.join("\n");
        expect(text).toContain("NO PACKAGE BUCKET");
        expect(text).toContain("every bucket this stack can read");
        expect(text).toContain("WEBHOOK SIGNATURE VERIFICATION IS OFF");
        expect(text).toContain("Anyone who can reach the webhook endpoint");
        expect(text).toContain("!!!!");
    });

    it("prints nothing when nothing applies", () => {
        const write = jest.fn();
        expect(printRiskyConfigWarnings({ bucket: "b", enableVerification: true }, write)).toBe(0);
        expect(write).not.toHaveBeenCalled();
    });
});
