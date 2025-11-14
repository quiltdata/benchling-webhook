/**
 * HTTP Client using native Node.js http/https modules
 *
 * This maintains the original implementation but wrapped in an interface.
 */

import { IHttpClient } from "../interfaces/aws-provider";

export class NodeHttpClient implements IHttpClient {
    async fetchJson(url: string): Promise<unknown> {
        const https = await import("https");
        const http = await import("http");

        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const client = parsedUrl.protocol === "https:" ? https : http;

            const options = {
                headers: {
                    "User-Agent": "benchling-webhook-config-tool/1.0",
                    Accept: "application/json",
                },
            };

            client
                .get(url, options, (res) => {
                    let data = "";

                    if (res.statusCode !== 200) {
                        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                        return;
                    }

                    res.on("data", (chunk: Buffer) => {
                        data += chunk.toString();
                    });

                    res.on("end", () => {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            const error = e as Error;
                            reject(new Error(`Failed to parse JSON: ${error.message}`));
                        }
                    });
                })
                .on("error", reject);
        });
    }
}
