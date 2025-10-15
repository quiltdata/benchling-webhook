import { createSign, generateKeyPairSync, randomUUID } from "crypto";

type Handler = (event: {
    bodyBase64: string;
    headers?: Record<string, string>;
    sourceIp?: string;
}) => Promise<unknown>;

const buildSignedEvent = (
    timestampSeconds: number,
    sourceIp: string,
) => {
    const body = {
        app: { id: "app_example" },
        appDefinition: { id: "appdef_test" },
        baseURL: "https://example.benchling.com",
        channel: "events",
        message: { id: randomUUID() },
    };

    const rawBody = JSON.stringify(body);
    const webhookId = `wh_${randomUUID()}`;
    const payloadToSign = `${webhookId}.${timestampSeconds}.${rawBody}`;

    const { privateKey, publicKey } = generateKeyPairSync("ec", {
        namedCurve: "prime256v1",
    });

    const signer = createSign("sha256");
    signer.update(payloadToSign);
    signer.end();

    const derSignature = signer.sign(privateKey).toString("base64");

    const headers = {
        "webhook-id": webhookId,
        "webhook-timestamp": timestampSeconds.toString(),
        "webhook-signature": `v1bder,${derSignature}`,
    };

    return {
        body,
        event: {
            bodyBase64: Buffer.from(rawBody, "utf8").toString("base64"),
            headers,
            sourceIp,
        },
        jwk: publicKey.export({ format: "jwk" }) as JsonWebKey,
        rawBody,
    };
};

const mockFetch = jest.fn();

const importHandler = async (allowList?: string): Promise<Handler> => {
    jest.resetModules();
    if (allowList === undefined) {
        delete process.env.WEBHOOK_ALLOW_LIST;
    } else {
        process.env.WEBHOOK_ALLOW_LIST = allowList;
    }
    const module = await import("../lib/lambda/verify-webhook");
    return module.handler as Handler;
};

describe("verify-webhook lambda", () => {
    beforeEach(() => {
        mockFetch.mockReset();
        global.fetch = mockFetch as unknown as typeof fetch;
    });

    afterEach(() => {
        delete (global as { fetch?: typeof fetch }).fetch;
        delete process.env.WEBHOOK_ALLOW_LIST;
    });

    test("accepts a valid, allow-listed webhook", async () => {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const { event, jwk, body } = buildSignedEvent(nowSeconds, "203.0.113.10");

        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => ({ keys: [jwk] }),
        } as unknown as Response);

        const handler = await importHandler("203.0.113.10");

        await expect(handler(event)).resolves.toEqual(body);
        expect(mockFetch).toHaveBeenCalledWith(
            "https://apps.benchling.com/api/v1/apps/appdef_test/jwks",
        );
    });

    test("rejects requests from non-allow-listed IPs", async () => {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const { event } = buildSignedEvent(nowSeconds, "198.51.100.5");

        const handler = await importHandler("203.0.113.10");

        await expect(handler(event)).rejects.toThrow(
            "source IP not in allow list",
        );
        expect(mockFetch).not.toHaveBeenCalled();
    });

    test("rejects requests with invalid signatures", async () => {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const { event, jwk } = buildSignedEvent(nowSeconds, "203.0.113.10");

        const badEvent = {
            ...event,
            headers: {
                ...event.headers,
                "webhook-signature": "v1bder,ZmFrZXNpZw==",
            },
        };

        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => ({ keys: [jwk] }),
        } as unknown as Response);

        const handler = await importHandler("203.0.113.10");

        await expect(handler(badEvent)).rejects.toThrow(
            "No matching signature found",
        );
    });

    test("rejects old timestamps", async () => {
        const timestampSeconds = Math.floor(Date.now() / 1000) - 600;
        const { event, jwk } = buildSignedEvent(timestampSeconds, "203.0.113.10");

        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => ({ keys: [jwk] }),
        } as unknown as Response);

        const handler = await importHandler("203.0.113.10");

        await expect(handler(event)).rejects.toThrow("Message timestamp too old");
    });
});
