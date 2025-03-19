import AWS from "aws-sdk";
import AdmZip from "adm-zip";
import * as https from "https";

import { ProcessExportEvent } from "../types";

const s3 = new AWS.S3();

interface ProcessExportResult {
    statusCode: number;
    body: string;
}

export const handler = async (event: ProcessExportEvent): Promise<ProcessExportResult> => {
    console.log("Processing export with event:", JSON.stringify(event));

    try {
        // Download the ZIP file from Benchling
        const zipBuffer = await downloadFile(event.downloadURL);

        // Process the ZIP contents
        const zip = new AdmZip(zipBuffer);
        const entries = zip.getEntries();

        // Upload all files in the ZIP
        const uploadPromises = entries.map(async (entry: AdmZip.IZipEntry) => {
            if (!entry.isDirectory) {
                const key = `${event.packageName}/${entry.entryName}`;
                const fileContent = entry.getData();

                await s3.putObject({
                    Bucket: event.registry,
                    Key: key,
                    Body: fileContent,
                    ContentType: getContentType(entry.entryName),
                }).promise();
            }
        });

        await Promise.all(uploadPromises);

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Export processed successfully",
                numFiles: entries.length,
            }),
        };
    } catch (error) {
        console.error("Error processing export:", error);
        throw error;
    }
};

function downloadFile(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            const chunks: Buffer[] = [];

            response.on("data", (chunk: Buffer) => {
                chunks.push(chunk);
            });

            response.on("end", () => {
                resolve(Buffer.concat(chunks));
            });

            response.on("error", (error) => {
                reject(error);
            });
        }).on("error", (error) => {
            reject(error);
        });
    });
}

import { MIME_TYPES } from "../constants";

function getContentType(fileName: string): string {
    const extension = fileName.split(".").pop()?.toLowerCase() || "";
    const mimeTypeKey = extension.toUpperCase() as keyof typeof MIME_TYPES;
    return MIME_TYPES[mimeTypeKey] || MIME_TYPES.DEFAULT;
}
