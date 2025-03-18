import { S3Event } from 'aws-lambda';
import * as AWS from 'aws-sdk';
import * as AdmZip from 'adm-zip';

const s3 = new AWS.S3();

export const handler = async (event: S3Event): Promise<void> => {
    for (const record of event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
        
        // Download the export zip file
        const zipFile = await s3.getObject({
            Bucket: bucket,
            Key: key
        }).promise();

        if (!zipFile.Body) {
            throw new Error('Empty zip file received');
        }

        // Process the zip file
        const zip = new AdmZip(zipFile.Body as Buffer);
        const entries = zip.getEntries();

        // Find and process the notebook HTML
        const notebookEntry = entries.find(entry => entry.entryName.endsWith('.html'));
        if (!notebookEntry) {
            throw new Error('No HTML file found in export');
        }

        // Extract the HTML content
        const htmlContent = notebookEntry.getData().toString('utf8');

        // Upload the HTML content
        const targetKey = key.replace('.zip', '.html');
        await s3.putObject({
            Bucket: bucket,
            Key: targetKey,
            Body: htmlContent,
            ContentType: 'text/html'
        }).promise();
    }
};
