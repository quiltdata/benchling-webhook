import { createPublicKey, createVerify, JsonWebKey as NodeJsonWebKey } from "crypto";

const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;
const allowList = (process.env.WEBHOOK_ALLOW_LIST || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

interface VerificationEvent {
    bodyBase64: string;
    headers?: Record<string, string | undefined>;
    sourceIp?: string;
}

type JwkKey = NodeJsonWebKey & { kid: string };

interface JwkResponse {
    keys: JwkKey[];
}

class WebhookVerificationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "WebhookVerificationError";
    }
}

const normalizeHeaders = (
    headers: Record<string, string | undefined> = {},
): Record<string, string> => {
    return Object.keys(headers).reduce<Record<string, string>>((acc, key) => {
        if (typeof headers[key] === "string" && headers[key]) {
            acc[key.toLowerCase()] = headers[key] as string;
        }
        return acc;
    }, {});
};

const ensureHeader = (
    headers: Record<string, string>,
    headerName: string,
): string => {
    const value = headers[headerName];
    if (!value) {
        throw new WebhookVerificationError(
            `Missing required header: ${headerName}`,
        );
    }
    return value;
};

const resolveSourceIp = (
    eventSourceIp: string | undefined,
): string | undefined => {
    return eventSourceIp;
};

const enforceAllowList = (
    sourceIp: string | undefined,
): void => {
    if (allowList.length === 0) {
        return;
    }
    if (!sourceIp || !allowList.includes(sourceIp)) {
        throw new WebhookVerificationError("source IP not in allow list");
    }
};

const enforceTimestampTolerance = (timestampHeader: string): void => {
    const timestampSeconds = Number(timestampHeader);
    if (!Number.isFinite(timestampSeconds)) {
        throw new WebhookVerificationError("Invalid webhook-timestamp header");
    }

    const timestampMs = timestampSeconds * 1000;
    const now = Date.now();

    if (timestampMs < now - WEBHOOK_TOLERANCE_MS) {
        throw new WebhookVerificationError("Message timestamp too old");
    }
    if (timestampMs > now + WEBHOOK_TOLERANCE_MS) {
        throw new WebhookVerificationError("Message timestamp too new");
    }
};

const extractDerSignatures = (signatureHeader: string): Buffer[] => {
    const versionedSignatures = signatureHeader.split(" ");
    const derEncoded = versionedSignatures
        .map((versionedSig) => {
            const [version, signature] = versionedSig.split(",");
            if (version && version.includes("der") && signature) {
                return signature;
            }
            return undefined;
        })
        .filter((value): value is string => Boolean(value));

    if (derEncoded.length === 0) {
        throw new WebhookVerificationError("No DER-encoded signatures found");
    }

    return derEncoded.map((signature) => Buffer.from(signature, "base64"));
};

const fetchJwks = async (appDefinitionId: string): Promise<JwkKey[]> => {
    const jwksUrl = `https://apps.benchling.com/api/v1/apps/${appDefinitionId}/jwks`;

    let response: Response;
    try {
        response = await fetch(jwksUrl);
    } catch (error) {
        throw new WebhookVerificationError(
            `Failed to reach Benchling JWKS endpoint: ${(error as Error).message}`,
        );
    }

    if (!response.ok) {
        throw new WebhookVerificationError(
            `Failed to fetch JWKS: ${response.status} ${response.statusText}`,
        );
    }

    let data: JwkResponse;
    try {
        data = (await response.json()) as JwkResponse;
    } catch (error) {
        throw new WebhookVerificationError(
            `Unable to parse JWKS response: ${(error as Error).message}`,
        );
    }

    if (!data?.keys || !Array.isArray(data.keys) || data.keys.length === 0) {
        throw new WebhookVerificationError("JWKS response did not include keys");
    }

    return data.keys;
};

const verifyWithJwk = (
    jwk: JwkKey,
    payload: string,
    signatures: Buffer[],
): boolean => {
    if (jwk.kty !== "EC") {
        return false;
    }

    const publicKey = createPublicKey({ key: jwk, format: "jwk" });

    return signatures.some((signature) => {
        const verifier = createVerify("sha256");
        verifier.update(payload);
        verifier.end();
        try {
            return verifier.verify(publicKey, signature);
        } catch {
            return false;
        }
    });
};

export const handler = async (
    event: VerificationEvent,
): Promise<Record<string, unknown>> => {
    console.log("Received event:", JSON.stringify(event, null, 2));

    if (!event || !event.bodyBase64) {
        throw new WebhookVerificationError("Missing request body");
    }

    const headers = normalizeHeaders(event.headers);

    const sourceIp = resolveSourceIp(event.sourceIp);
    enforceAllowList(sourceIp);

    const webhookId = ensureHeader(headers, "webhook-id");
    const webhookTimestamp = ensureHeader(headers, "webhook-timestamp");
    const webhookSignatureHeader = ensureHeader(headers, "webhook-signature");

    enforceTimestampTolerance(webhookTimestamp);

    const derSignatures = extractDerSignatures(webhookSignatureHeader);

    const rawBodyBuffer = Buffer.from(event.bodyBase64, "base64");
    const rawBody = rawBodyBuffer.toString("utf8");

    let parsedBody: Record<string, unknown>;
    try {
        parsedBody = JSON.parse(rawBody) as Record<string, unknown>;
    } catch (error) {
        throw new WebhookVerificationError("Request body is not valid JSON");
    }

    const appDefinition = parsedBody.appDefinition as { id?: string } | undefined;
    const appDefinitionId = appDefinition?.id;
    if (!appDefinitionId) {
        throw new WebhookVerificationError("Missing appDefinition.id in payload");
    }

    const jwks = await fetchJwks(appDefinitionId);

    const payloadToVerify = `${webhookId}.${webhookTimestamp}.${rawBody}`;

    const verified = jwks.some((jwk) => verifyWithJwk(jwk, payloadToVerify, derSignatures));
    if (!verified) {
        throw new WebhookVerificationError("No matching signature found");
    }

    return parsedBody;
};
