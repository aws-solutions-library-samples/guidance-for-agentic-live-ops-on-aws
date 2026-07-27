const {
    S3VectorsClient,
    CreateVectorBucketCommand,
    DeleteVectorBucketCommand,
    ListIndexesCommand,
    DeleteIndexCommand,
} = require("@aws-sdk/client-s3vectors");

const https = require("https");
const url = require("url");

exports.handler = async (event, context) => {
    console.log("Event:", JSON.stringify(event, null, 2));

    const responseUrl = event.ResponseURL;
    const physicalResourceId =
        event.PhysicalResourceId || event.ResourceProperties.vectorBucketName;
    const region = context.invokedFunctionArn.split(":")[3];
    const accountId = context.invokedFunctionArn.split(":")[4];

    try {
        const client = new S3VectorsClient({ region: region });
        let responseData = {};

        if (event.RequestType === "Create") {
            const vectorBucketName = event.ResourceProperties.vectorBucketName;
            if (!vectorBucketName) {
                throw new Error("vectorBucketName is required");
            }

            const createParams = {
                vectorBucketName: vectorBucketName,
            };

            if (event.ResourceProperties.encryptionConfiguration) {
                createParams.encryptionConfiguration =
                    event.ResourceProperties.encryptionConfiguration;
            }

            console.log("Creating vector bucket with params:", createParams);
            const command = new CreateVectorBucketCommand(createParams);
            await client.send(command);

            const vectorBucketArn = `arn:aws:s3vectors:${region}:${accountId}:bucket/${vectorBucketName}`;
            responseData = {
                VectorBucketName: vectorBucketName,
                VectorBucketArn: vectorBucketArn,
            };

            await sendResponse(
                responseUrl,
                context,
                "SUCCESS",
                responseData,
                vectorBucketName,
                event
            );
        } else if (event.RequestType === "Delete") {
            const vectorBucketName = physicalResourceId;
            const vectorBucketArn = `arn:aws:s3vectors:${region}:${accountId}:bucket/${vectorBucketName}`;

            // Delete all indexes in the bucket first
            try {
                console.log("Listing indexes in bucket:", vectorBucketArn);
                const listIndexesCommand = new ListIndexesCommand({ vectorBucketArn });
                const listResponse = await client.send(listIndexesCommand);

                if (listResponse.indexes && listResponse.indexes.length > 0) {
                    for (const index of listResponse.indexes) {
                        console.log("Deleting index:", index.indexArn);
                        const deleteIndexCommand = new DeleteIndexCommand({
                            indexArn: index.indexArn,
                        });
                        await client.send(deleteIndexCommand);
                    }
                }
            } catch (error) {
                if (
                    error.name !== "NotFoundException" &&
                    error.name !== "ResourceNotFoundException"
                ) {
                    console.error("Error listing/deleting indexes:", error);
                    throw error;
                }
                console.log("No indexes found or already deleted");
            }

            // Then delete the bucket
            try {
                console.log("Deleting vector bucket:", vectorBucketArn);
                const deleteBucketCommand = new DeleteVectorBucketCommand({ vectorBucketArn });
                await client.send(deleteBucketCommand);
            } catch (error) {
                if (
                    error.name !== "NotFoundException" &&
                    error.name !== "ResourceNotFoundException"
                ) {
                    console.error("Error deleting bucket:", error);
                    throw error;
                }
                console.log("Bucket already deleted");
            }

            await sendResponse(responseUrl, context, "SUCCESS", {}, physicalResourceId, event);
        } else if (event.RequestType === "Update") {
            // The S3 Vectors API does not currently support updates.
            const vectorBucketName = physicalResourceId;
            const vectorBucketArn = `arn:aws:s3vectors:${region}:${accountId}:bucket/${vectorBucketName}`;

            responseData = {
                VectorBucketName: vectorBucketName,
                VectorBucketArn: vectorBucketArn,
            };

            await sendResponse(
                responseUrl,
                context,
                "SUCCESS",
                responseData,
                physicalResourceId,
                event
            );
        }
    } catch (error) {
        console.error("Lambda execution error:", error);
        await sendResponse(
            responseUrl,
            context,
            "FAILED",
            { Reason: error.message },
            physicalResourceId,
            event
        );
    }
};

async function sendResponse(responseUrl, context, status, responseData, physicalResourceId, event) {
    const responseBody = JSON.stringify({
        Status: status,
        Reason: `See CloudWatch Log Stream: ${context.logStreamName}`,
        PhysicalResourceId: physicalResourceId,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: responseData,
    });

    console.log("Sending response:", responseBody);

    const parsedUrl = url.parse(responseUrl);
    const options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.path,
        method: "PUT",
        headers: {
            "content-type": "",
            "content-length": responseBody.length,
        },
    };

    return new Promise((resolve, reject) => {
        const request = https.request(options, (response) => {
            console.log("Response status code:", response.statusCode);
            resolve();
        });

        request.on("error", (error) => {
            console.error("Error sending response:", error);
            reject(error);
        });

        request.write(responseBody);
        request.end();
    });
}
