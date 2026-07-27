const {
    S3VectorsClient,
    CreateIndexCommand,
    DeleteIndexCommand,
} = require("@aws-sdk/client-s3vectors");

const https = require("https");
const url = require("url");

exports.handler = async (event, context) => {
    console.log("Event:", JSON.stringify(event, null, 2));

    const responseUrl = event.ResponseURL;
    const region = context.invokedFunctionArn.split(":")[3];
    const accountId = context.invokedFunctionArn.split(":")[4];

    const vectorBucketName = event.ResourceProperties.vectorBucketName;
    const indexName = event.ResourceProperties.indexName;
    const indexArn = `arn:aws:s3vectors:${region}:${accountId}:bucket/${vectorBucketName}/index/${indexName}`;
    const physicalResourceId = `${vectorBucketName}-${indexName}`;

    if (!vectorBucketName || !indexName) {
        await sendResponse(
            responseUrl,
            context,
            "FAILED",
            { Reason: "vectorBucketName and indexName are required" },
            physicalResourceId,
            event
        );
        return;
    }

    try {
        const client = new S3VectorsClient({ region: region });
        let responseData = {};

        if (event.RequestType === "Create") {
            const createParams = {
                vectorBucketName: vectorBucketName,
                indexName: indexName,
                dataType: event.ResourceProperties.dataType,
                dimension: parseInt(event.ResourceProperties.dimension),
                distanceMetric: event.ResourceProperties.distanceMetric,
            };

            if (event.ResourceProperties.metadataConfiguration) {
                createParams.metadataConfiguration = event.ResourceProperties.metadataConfiguration;
            }

            console.log("Creating vector index with params:", createParams);
            const command = new CreateIndexCommand(createParams);
            await client.send(command);

            responseData = {
                IndexArn: indexArn,
                IndexName: indexName,
                VectorBucketName: vectorBucketName,
            };

            await sendResponse(
                responseUrl,
                context,
                "SUCCESS",
                responseData,
                physicalResourceId,
                event
            );
        } else if (event.RequestType === "Delete") {
            try {
                console.log("Deleting vector index:", indexArn);
                const command = new DeleteIndexCommand({ indexArn: indexArn });
                await client.send(command);
            } catch (error) {
                if (
                    error.name !== "NotFoundException" &&
                    error.name !== "ResourceNotFoundException"
                ) {
                    console.error("Error deleting index:", error);
                    throw error;
                }
                console.log("Index already deleted");
            }

            await sendResponse(responseUrl, context, "SUCCESS", {}, physicalResourceId, event);
        } else if (event.RequestType === "Update") {
            // The S3 Vectors API does not currently support updates.
            responseData = {
                IndexArn: indexArn,
                IndexName: indexName,
                VectorBucketName: vectorBucketName,
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
