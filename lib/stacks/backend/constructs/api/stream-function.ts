// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Logger } from "@aws-lambda-powertools/logger";
import { BedrockAgentCore, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const logger = new Logger({
    serviceName: "stream-agent",
    logLevel: (process.env.LOG_LEVEL as "DEBUG" | "INFO" | "WARN" | "ERROR") || "INFO",
});

const dynamoClient = new DynamoDBClient();
const dynamoDocumentClient = DynamoDBDocumentClient.from(dynamoClient);
const bedrockAgentCoreClient = new BedrockAgentCore();

const EVENTS_TABLE_NAME = process.env.EVENTS_TABLE_NAME!;
const AGENT_RUNTIME_ARN = process.env.AGENT_RUNTIME_ARN!;

interface SubmitEventRequest {
    request_id: string;
    message: string;
    session_id?: string;
}

export const handler = awslambda.streamifyResponse(
    async (event: APIGatewayProxyEventV2, responseStream) => {
        // Handle OPTIONS requests for CORS preflight
        if (event.requestContext.http.method === "OPTIONS") {
            responseStream.write("");
            return;
        }

        const body: SubmitEventRequest = JSON.parse(event.body || "{}");
        const { request_id, message, session_id } = body;
        if (!request_id || !message) {
            throw new Error("Missing required fields: request_id and message.");
        }

        let timestamp: string | undefined;
        let runtimeSessionId: string | undefined;

        try {
            // Extract user identity from the request context
            // For Lambda Function URL with IAM auth, the user identity is in the requestContext
            const requestContext = event.requestContext as Record<string, unknown>;
            const authorizer = requestContext?.authorizer as Record<string, unknown> | undefined;
            const iam = authorizer?.iam as Record<string, unknown> | undefined;
            const identity = requestContext?.identity as Record<string, unknown> | undefined;
            const userArn = identity?.userArn as string | undefined;

            const userIdentity =
                (iam?.userId as string) ||
                (iam?.principalId as string) ||
                userArn?.split("/").pop() ||
                "anonymous-user";

            logger.info("Processing stream request", {
                request_id,
                user_message: message,
                session_id_from_frontend: session_id,
                user_identity: userIdentity,
                request_context: event.requestContext,
            });

            timestamp = new Date().toISOString();

            // Generate session ID if not provided (use once consistently)
            runtimeSessionId = session_id || `chat-session-${crypto.randomUUID()}`;

            logger.info("Session ID determined", {
                request_id,
                session_id_from_frontend: session_id,
                runtime_session_id: runtimeSessionId,
                is_new_session: !session_id,
            });

            // Create initial event record in DynamoDB (following supply chain pattern)
            await dynamoDocumentClient.send(
                new PutCommand({
                    TableName: EVENTS_TABLE_NAME,
                    Item: {
                        request_id,
                        entity_type_timestamp: `event#${timestamp}`,
                        status: "PROCESSING",
                        message,
                        session_id: runtimeSessionId,
                        createdDateTime: timestamp,
                    },
                })
            );

            logger.info("Invoking Runtime directly via AgentCore", {
                request_id,
                user_message: message,
                runtimeSessionId,
                AGENT_RUNTIME_ARN,
            });

            // Call the runtime directly via AgentCore (not MCP)
            const runtimePayload = {
                prompt: message,
                session_id: runtimeSessionId,
                actor_id: userIdentity,
                request_id,
            };

            logger.info("Invoking AgentCore runtime with reasoning support", {
                request_id,
                runtimeSessionId,
                AGENT_RUNTIME_ARN,
            });

            const output = await bedrockAgentCoreClient.send(
                new InvokeAgentRuntimeCommand({
                    agentRuntimeArn: AGENT_RUNTIME_ARN,
                    runtimeSessionId,
                    payload: new TextEncoder().encode(JSON.stringify(runtimePayload)),
                })
            );

            if (!output.response) {
                logger.error("No response stream from AgentCore", { request_id });
                throw new Error("No response stream from AgentCore.");
            }

            logger.info("Runtime response stream received", { request_id });

            // Stream the response from AgentCore - pass through raw chunks for real-time streaming
            const agentStream = Readable.from(
                (async function* () {
                    logger.info("Starting real-time stream from AgentCore", { request_id });

                    for await (const chunk of output.response as AsyncIterable<Uint8Array>) {
                        const chunkText = new TextDecoder().decode(chunk);

                        logger.debug("🔄 STREAM CHUNK RECEIVED", {
                            request_id,
                            chunk_length: chunkText.length,
                            chunk_preview: chunkText.substring(0, 200),
                            chunk_type: "raw_agentcore_output",
                        });

                        // Pass through the raw SSE chunk from AgentCore directly
                        // This enables real-time streaming of thinking/analysis/content events
                        yield chunk;
                    }

                    logger.info("Real-time stream completed", { request_id });
                })()
            );

            await pipeline(agentStream, responseStream);
            logger.info("Stream completed!", { request_id });

            // Update event status to COMPLETED in DynamoDB
            try {
                await dynamoDocumentClient.send(
                    new PutCommand({
                        TableName: EVENTS_TABLE_NAME,
                        Item: {
                            request_id,
                            entity_type_timestamp: `event#${timestamp}`,
                            status: "COMPLETED",
                            message,
                            session_id: runtimeSessionId,
                            createdDateTime: timestamp,
                            completedDateTime: new Date().toISOString(),
                        },
                    })
                );
                logger.info("Event status updated to COMPLETED", { request_id });
            } catch (error) {
                logger.error("Failed to update event status", {
                    request_id,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        } catch (error) {
            logger.error("Stream processing failed", {
                request_id,
                error: error instanceof Error ? error.message : String(error),
            });

            // Update event status to FAILED in DynamoDB if we got far enough to create the record
            try {
                await dynamoDocumentClient.send(
                    new PutCommand({
                        TableName: EVENTS_TABLE_NAME,
                        Item: {
                            request_id,
                            entity_type_timestamp: `event#${timestamp}`,
                            status: "FAILED",
                            message,
                            session_id: runtimeSessionId,
                            createdDateTime: timestamp,
                            failedDateTime: new Date().toISOString(),
                            error: error instanceof Error ? error.message : String(error),
                        },
                    })
                );
            } catch (dbError) {
                logger.error("Failed to update event status to FAILED", {
                    request_id,
                    dbError: dbError instanceof Error ? dbError.message : String(dbError),
                });
            }

            throw error;
        }
    }
);
