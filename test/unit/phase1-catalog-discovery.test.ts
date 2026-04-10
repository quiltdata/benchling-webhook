jest.mock("child_process", () => ({
    execSync: jest.fn(),
}));

jest.mock("inquirer", () => ({
    __esModule: true,
    default: {
        prompt: jest.fn(),
    },
}));

const mockChalkFn = (str: string) => str;
const chalkMethods = {
    blue: mockChalkFn,
    green: mockChalkFn,
    yellow: mockChalkFn,
    red: mockChalkFn,
    bold: mockChalkFn,
    cyan: mockChalkFn,
    dim: mockChalkFn,
};

Object.keys(chalkMethods).forEach(method => {
    (chalkMethods as any)[method] = Object.assign(mockChalkFn, chalkMethods);
});

jest.mock("chalk", () => ({
    default: chalkMethods,
    ...chalkMethods,
}));

import inquirer from "inquirer";
import { execSync } from "child_process";
import { runCatalogDiscovery } from "../../lib/wizard/phase1-catalog-discovery";

describe("runCatalogDiscovery", () => {
    const mockPrompt = inquirer.prompt as jest.MockedFunction<typeof inquirer.prompt>;
    const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockExecSync.mockImplementation(() => {
            throw new Error("quilt3 not configured");
        });
    });

    it("normalizes a full URL provided via CLI", async () => {
        const result = await runCatalogDiscovery({
            catalogUrl: "https://nightly.quilttest.com/",
            yes: true,
        });

        expect(result.catalogDns).toBe("nightly.quilttest.com");
        expect(result.wasManuallyEntered).toBe(true);
    });

    it("accepts and normalizes a full URL during manual entry", async () => {
        mockPrompt.mockResolvedValueOnce({
            manualCatalog: "nightly.quilttest.com",
        } as never);

        const result = await runCatalogDiscovery({
            yes: false,
        });

        const promptConfig = (mockPrompt.mock.calls[0][0] as any[])[0];
        expect(promptConfig.message).toContain("DNS name or URL");
        expect(promptConfig.validate("https://nightly.quilttest.com/")).toBe(true);
        expect(promptConfig.filter("https://nightly.quilttest.com/")).toBe("nightly.quilttest.com");

        expect(result.catalogDns).toBe("nightly.quilttest.com");
        expect(result.wasManuallyEntered).toBe(true);
    });

    it("accepts and normalizes a full URL when replacing detected catalog", async () => {
        mockExecSync.mockReturnValue("https://nightly.quilttest.com\n" as never);
        mockPrompt
            .mockResolvedValueOnce({ isCorrect: false } as never)
            .mockResolvedValueOnce({ manualCatalog: "alt.quilt.example.com" } as never);

        const result = await runCatalogDiscovery({
            yes: false,
        });

        const manualPromptConfig = (mockPrompt.mock.calls[1][0] as any[])[0];
        expect(manualPromptConfig.message).toContain("DNS name or URL");
        expect(manualPromptConfig.validate("https://alt.quilt.example.com/")).toBe(true);
        expect(manualPromptConfig.filter("https://alt.quilt.example.com/")).toBe("alt.quilt.example.com");

        expect(result.catalogDns).toBe("alt.quilt.example.com");
        expect(result.detectedCatalog).toBe("nightly.quilttest.com");
    });
});
