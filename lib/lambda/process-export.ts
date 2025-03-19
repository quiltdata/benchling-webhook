import AWS from 'aws-sdk';
import AdmZip from 'adm-zip';
import * as https from 'https';

interface ProcessExportEvent {
    downloadURL: string;
    packageName: string;
    registry: string;
}

const s3 = new AWS.S3();

export const handler = async (event: ProcessExportEvent): Promise<any> => {
    console.log('Processing export with event:', JSON.stringify(event));
    
    try {
        // Download the ZIP file from Benchling
        const zipBuffer = await downloadFile(event.downloadURL);
        
        // Process the ZIP contents
        const zip = new AdmZip(zipBuffer);
        const entries = zip.getEntries();

        // Find and process the notebook HTML
        const notebookEntry = entries.find(entry => entry.entryName.endsWith('.html'));
        if (!notebookEntry) {
            throw new Error('No HTML file found in export');
        }

        // Extract the HTML content
        const htmlContent = notebookEntry.getData().toString('utf8');

        // Upload the HTML content
        const key = `${event.packageName}/notebook.html`;
        await s3.putObject({
            Bucket: event.registry,
            Key: key,
            Body: htmlContent,
            ContentType: 'text/html'
        }).promise();

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Export processed successfully',
                numFiles: entries.length,
                outputKey: key
            })
        };
    } catch (error) {
        console.error('Error processing export:', error);
        throw error;
    }
};

function downloadFile(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            const chunks: Buffer[] = [];
            
            response.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });
            
            response.on('end', () => {
                resolve(Buffer.concat(chunks));
            });
            
            response.on('error', (error) => {
                reject(error);
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
}
