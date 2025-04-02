import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3Client = new S3Client({});

export interface ProcessStringEvent {
    bucket: string;
    key: string;
    body: string;
}

export async function handler(event: ProcessStringEvent): Promise<void> {
    const { bucket, key, body } = event;

    await s3Client.send(
        new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
        })
    );
}
