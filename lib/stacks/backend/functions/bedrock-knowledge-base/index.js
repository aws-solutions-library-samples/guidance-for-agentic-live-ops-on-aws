const {
    BedrockAgentClient,
    CreateKnowledgeBaseCommand,
    DeleteKnowledgeBaseCommand,
    GetKnowledgeBaseCommand,
    UpdateKnowledgeBaseCommand,
} = require("@aws-sdk/client-bedrock-agent");

const https = require("https");
const url = require("url");

exports.handler = async (event, context) => {
    console.log("Event:", JSON.stringify(event, null, 2));

    const responseUrl = event.ResponseURL;
    const region = context.invokedFunctionArn.split(":")[3];
    const accountId = context.invokedFunctionArn.split(":")[4];

    try {
        const client = new BedrockAgentClient({ region: region });

        if (event.RequestType === "Create") {
            const createParams = {
                name: event.ResourceProperties.knowledgeBaseName,
                roleArn: event.ResourceProperties.roleArn,
                knowledgeBaseConfiguration: {
                    type: "VECTOR",
                    vectorKnowledgeBaseConfiguration: {
                        embeddingModelArn:
                            event.ResourceProperties.knowledgeBaseConfiguration.embeddingModelArn,
                        embeddingModelConfiguration: {
                            bedrockEmbeddingModelConfiguration: {
                                dimensions: parseInt(
                                    event.ResourceProperties.knowledgeBaseConfiguration.dimensions
                                ),
                                embeddingDataType:
                                    event.ResourceProperties.knowledgeBaseConfiguration
                                        .embeddingDataType,
                            },
                        },
                    },
                },
                storageConfiguration: {
                    type: "S3_VECTORS",
                    s3VectorsConfiguration: {
                        vectorBucketArn: event.ResourceProperties.vectorBucketArn,
                        indexArn: event.ResourceProperties.indexArn,
                    },
                },
            };

            if (event.ResourceProperties.description) {
                createParams.description = event.ResourceProperties.description;
            }

            if (event.ResourceProperties.clientToken) {
                createParams.clientToken = event.ResourceProperties.clientToken;
            }

            try {
                const command = new CreateKnowledgeBaseCommand(createParams);
                const createResponse = await client.send(command);
                const knowledgeBaseId = createResponse.knowledgeBase.knowledgeBaseId;

                await waitForKnowledgeBaseCreation(client, knowledgeBaseId, "ACTIVE");

                const responseData = {
                    KnowledgeBaseId: knowledgeBaseId,
                    KnowledgeBaseArn: createResponse.knowledgeBase.knowledgeBaseArn,
                };

                await sendResponse(
                    responseUrl,
                    context,
                    "SUCCESS",
                    responseData,
                    knowledgeBaseId,
                    event
                );
            } catch (error) {
                console.error("Error creating knowledge base:", error);
                await sendResponse(
                    responseUrl,
                    context,
                    "FAILED",
                    { Reason: error.message },
                    "failed-kb-create",
                    event
                );
            }
        } else if (event.RequestType === "Delete") {
            const knowledgeBaseId = event.PhysicalResourceId;

            try {
                try {
                    const deleteCommand = new DeleteKnowledgeBaseCommand({ knowledgeBaseId });
                    await client.send(deleteCommand);
                    await waitForKnowledgeBaseDeletion(client, knowledgeBaseId);
                } catch (error) {
                    if (error.name !== "ResourceNotFoundException") {
                        console.error("Error deleting knowledge base:", error);
                        throw error;
                    }
                    console.log("Knowledge base already deleted");
                }

                await sendResponse(responseUrl, context, "SUCCESS", {}, knowledgeBaseId, event);
            } catch (error) {
                console.error("Error in delete operation:", error);
                await sendResponse(
                    responseUrl,
                    context,
                    "FAILED",
                    { Reason: error.message },
                    knowledgeBaseId,
                    event
                );
            }
        } else if (event.RequestType === "Update") {
            const knowledgeBaseId = event.PhysicalResourceId;
            const mergedProps = deepMerge(event.OldResourceProperties, event.ResourceProperties);

            const updateParams = {
                knowledgeBaseId: knowledgeBaseId,
                name: mergedProps.knowledgeBaseName,
                roleArn: mergedProps.roleArn,
                description: mergedProps.description,
                knowledgeBaseConfiguration: {
                    type: "VECTOR",
                    vectorKnowledgeBaseConfiguration: {
                        embeddingModelArn: mergedProps.knowledgeBaseConfiguration.embeddingModelArn,
                        embeddingModelConfiguration: {
                            bedrockEmbeddingModelConfiguration: {
                                dimensions: parseInt(
                                    mergedProps.knowledgeBaseConfiguration.dimensions
                                ),
                                embeddingDataType:
                                    mergedProps.knowledgeBaseConfiguration.embeddingDataType,
                            },
                        },
                    },
                },
                storageConfiguration: {
                    type: "S3_VECTORS",
                    s3VectorsConfiguration: {
                        vectorBucketArn: mergedProps.vectorBucketArn,
                        indexArn: mergedProps.indexArn,
                    },
                },
            };

            try {
                const command = new UpdateKnowledgeBaseCommand(updateParams);
                await client.send(command);
                await waitForKnowledgeBaseCreation(client, knowledgeBaseId, "ACTIVE");

                const predictedKnowledgeBaseArn = `arn:aws:bedrock:${region}:${accountId}:knowledge-base/${knowledgeBaseId}`;

                const responseData = {
                    KnowledgeBaseId: knowledgeBaseId,
                    KnowledgeBaseArn: predictedKnowledgeBaseArn,
                };

                await sendResponse(
                    responseUrl,
                    context,
                    "SUCCESS",
                    responseData,
                    knowledgeBaseId,
                    event
                );
            } catch (error) {
                console.error("Error updating knowledge base:", error);
                await sendResponse(
                    responseUrl,
                    context,
                    "FAILED",
                    { Reason: error.message },
                    knowledgeBaseId,
                    event
                );
            }
        }
    } catch (error) {
        console.error("Unexpected error:", error);
        const physicalResourceId = event.PhysicalResourceId || "failed-resource";
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

async function waitForKnowledgeBaseCreation(
    client,
    knowledgeBaseId,
    status,
    maxAttempts = 30,
    delay = 10000
) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const getCommand = new GetKnowledgeBaseCommand({ knowledgeBaseId });
            const getResponse = await client.send(getCommand);
            const currentStatus = getResponse.knowledgeBase.status;

            if (currentStatus === status) {
                return;
            }

            console.log(`Knowledge Base ${knowledgeBaseId} status is ${currentStatus}, waiting...`);
        } catch (err) {
            if (err.name === "ResourceNotFoundException" && status !== "DELETING") {
                throw err;
            }
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
    }

    throw new Error(
        `Timed out waiting for Knowledge Base ${knowledgeBaseId} to reach status ${status}`
    );
}

async function waitForKnowledgeBaseDeletion(
    client,
    knowledgeBaseId,
    maxAttempts = 30,
    delay = 10000
) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            await client.send(new GetKnowledgeBaseCommand({ knowledgeBaseId }));
        } catch (err) {
            if (err.name === "ResourceNotFoundException") {
                return;
            }
            throw err;
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
    }

    throw new Error(`Timed out waiting for Knowledge Base ${knowledgeBaseId} to be deleted`);
}

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

function deepMerge(target, source) {
    for (const key in source) {
        if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
            if (!target[key]) target[key] = {};
            deepMerge(target[key], source[key]);
        } else {
            target[key] = source[key];
        }
    }
    return target;
}
