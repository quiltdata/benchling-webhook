import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import AdmZip from "adm-zip";
import { ProcessExportEvent } from "../types";

const s3Client = new S3Client({});

interface ProcessExportResult {
    statusCode: number;
    body: string;
}

export const handler = async (event: ProcessExportEvent): Promise<ProcessExportResult> => {
    console.log("Processing export with event:", JSON.stringify(event));

    try {
        // Validate input
        if (!event.downloadURL || !event.packageName || !event.registry) {
            throw new Error("Missing required parameters");
        }

        // Download the ZIP file from Benchling
        const zipBuffer = await downloadFile(event.downloadURL);

        // Process the ZIP contents
        const zip = new AdmZip(zipBuffer);
        const entries = zip.getEntries();
        
        if (entries.length === 0) {
            throw new Error("ZIP file is empty");
        }

        // Upload all files in the ZIP
        const uploadedFiles: string[] = [];
        const uploadPromises = entries.map(async (entry: AdmZip.IZipEntry) => {
            if (!entry.isDirectory) {
                const key = `${event.packageName}/${entry.entryName}`;
                const fileContent = entry.getData();

                await s3Client.send(new PutObjectCommand({
                    Bucket: event.registry,
                    Key: key,
                    Body: fileContent,
                }));
                uploadedFiles.push(key);
            }
        });

        await Promise.all(uploadPromises);

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Export processed successfully",
                numFiles: entries.length,
                files: uploadedFiles
            }),
        };
    } catch (error) {
        console.error("Error processing export:", error instanceof Error ? error.message : error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: "Failed to process export",
                error: error instanceof Error ? error.message : "Unknown error"
            })
        };
    }
};

async function downloadFile(url: string): Promise<Buffer> {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
        }
        return Buffer.from(await response.arrayBuffer());
    } catch (error) {
        console.error("Download failed:", error instanceof Error ? error.message : error);
        throw new Error(`Failed to download from ${url}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
}
