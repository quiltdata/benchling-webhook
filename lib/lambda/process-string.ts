import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3Client = new S3Client({});

export interface ProcessStringEvent {
    bucket: string;
    key: string;
    body: string;
}

export interface ProcessStringResult {
    statusCode: number;
    body: string;
}

export async function handler(event: ProcessStringEvent): Promise<ProcessStringResult> {
    console.log("Processing string with event:", JSON.stringify(event));

    try {
        const { bucket, key, body } = event;

        await s3Client.send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: body,
            })
        );

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "String processed successfully",
                key: key
            })
        };
    } catch (error) {
        console.error("Error processing string:", error);
        throw error;
    }
}
