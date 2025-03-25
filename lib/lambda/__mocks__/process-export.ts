export const handler = async (event: { downloadURL: string; packageName: string; registry: string; }): Promise<{
    statusCode: number;
    body: string;
}> => {
    console.log("Mock processing export with event:", JSON.stringify(event));
    return {
        statusCode: 200,
        body: JSON.stringify({ message: "Test mock" }),
    };
};
