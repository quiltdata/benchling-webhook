import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import AdmZip from "adm-zip";
import { ProcessExportEvent } from "../types";
import * as fs from "fs";
import * as path from "path";

const s3Client = new S3Client({});
const EXTERNAL_FILES_DIR = "./external-files";

interface ProcessExportResult {
    statusCode: number;
    body: string;
}

export const handler = async (event: ProcessExportEvent): Promise<ProcessExportResult> => {
    console.log("Processing export with event:", JSON.stringify(event));

    try {
        if (!fs.existsSync(EXTERNAL_FILES_DIR)) {
            fs.mkdirSync(EXTERNAL_FILES_DIR, { recursive: true });
        }

        if (event.downloadURL.includes('external-files')) {
            // Handle external file download
            await handleExternalFile(event);
        } else {
            // Handle ZIP export
            const zipBuffer = await downloadFile(event.downloadURL);

        // Process the ZIP contents
        const zip = new AdmZip(zipBuffer);
        const entries = zip.getEntries();

        // Upload all files in the ZIP
        const uploadPromises = entries.map(async (entry: AdmZip.IZipEntry) => {
            if (!entry.isDirectory) {
                const key = `${event.packageName}/${entry.entryName}`;
                const fileContent = entry.getData();

                await s3Client.send(new PutObjectCommand({
                    Bucket: event.registry,
                    Key: key,
                    Body: fileContent,
                    ContentType: getContentType(entry.entryName),
                }));
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

async function downloadFile(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
}

import { MIME_TYPES } from "../constants";

function getContentType(fileName: string): string {
    const extension = fileName.split(".").pop()?.toLowerCase() || "";
    const mimeTypeKey = extension.toUpperCase() as keyof typeof MIME_TYPES;
    return MIME_TYPES[mimeTypeKey] || MIME_TYPES.DEFAULT;
}

async function handleExternalFile(event: ProcessExportEvent): Promise<void> {
    const fileContent = await downloadFile(event.downloadURL);
    const fileName = path.basename(new URL(event.downloadURL).pathname);
    const filePath = path.join(EXTERNAL_FILES_DIR, fileName);
    
    // Write to local filesystem
    fs.writeFileSync(filePath, fileContent);
    
    // Upload to S3
    await s3Client.send(new PutObjectCommand({
        Bucket: event.registry,
        Key: `${event.packageName}/external-files/${fileName}`,
        Body: fileContent,
        ContentType: getContentType(fileName),
    }));
}
