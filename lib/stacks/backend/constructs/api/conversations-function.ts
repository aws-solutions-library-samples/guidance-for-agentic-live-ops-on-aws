// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Logger } from "@aws-lambda-powertools/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    PutCommand,
    QueryCommand,
    DeleteCommand,
    GetCommand,
} from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

const logger = new Logger({ serviceName: "conversations-api" });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient());
const TABLE = process.env.CONVERSATIONS_TABLE_NAME!;

function cors() {
    // CORS headers are handled by the Lambda Function URL configuration.
    // Do NOT add Access-Control-Allow-Origin here — it causes duplicate header errors.
    return { "Content-Type": "application/json" };
}

function getUserId(event: APIGatewayProxyEventV2): string {
    const ctx = event.requestContext as unknown as Record<string, unknown>;
    const auth = ctx?.authorizer as Record<string, unknown> | undefined;
    const iam = auth?.iam as Record<string, unknown> | undefined;
    const identity = ctx?.identity as Record<string, unknown> | undefined;
    const userArn = identity?.userArn as string | undefined;
    return (
        (iam?.userId as string) || (iam?.principalId as string) || userArn?.split("/").pop() || ""
    );
}

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
    return { statusCode, headers: cors(), body: JSON.stringify(body) };
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const method = event.requestContext.http.method;

    if (method === "OPTIONS") return json(200, {});

    const userId = getUserId(event);
    if (!userId) return json(401, { error: "Unauthorized" });

    try {
        // GET / — list conversations for user
        if (method === "GET" && !event.queryStringParameters?.conversationId) {
            const result = await ddb.send(
                new QueryCommand({
                    TableName: TABLE,
                    KeyConditionExpression: "userId = :uid",
                    ExpressionAttributeValues: { ":uid": userId },
                    ProjectionExpression: "conversationId, title, updatedAt, messageCount",
                    ScanIndexForward: false,
                })
            );
            return json(200, { conversations: result.Items ?? [] });
        }

        // GET /?conversationId=xxx — load single conversation
        if (method === "GET" && event.queryStringParameters?.conversationId) {
            const result = await ddb.send(
                new GetCommand({
                    TableName: TABLE,
                    Key: { userId, conversationId: event.queryStringParameters.conversationId },
                })
            );
            if (!result.Item) return json(404, { error: "Conversation not found" });
            return json(200, result.Item);
        }

        // POST — save/update conversation
        if (method === "POST") {
            const body = JSON.parse(event.body || "{}");
            if (!body.conversationId || !body.messages) {
                return json(400, { error: "conversationId and messages required" });
            }

            const firstUserMsg = body.messages.find(
                (m: Record<string, unknown>) => m.authorId !== "assistant"
            );
            const title =
                body.title ||
                (typeof firstUserMsg?.content === "string"
                    ? firstUserMsg.content.slice(0, 100)
                    : "Untitled");

            await ddb.send(
                new PutCommand({
                    TableName: TABLE,
                    Item: {
                        userId,
                        conversationId: body.conversationId,
                        title,
                        messages: body.messages,
                        messageCount: body.messages.length,
                        sessionId: body.sessionId,
                        updatedAt: new Date().toISOString(),
                    },
                })
            );
            logger.info("Conversation saved", { userId, conversationId: body.conversationId });
            return json(200, { saved: true, conversationId: body.conversationId });
        }

        // DELETE — delete conversation
        if (method === "DELETE") {
            const convId = event.queryStringParameters?.conversationId;
            if (!convId) return json(400, { error: "conversationId required" });

            await ddb.send(
                new DeleteCommand({ TableName: TABLE, Key: { userId, conversationId: convId } })
            );
            logger.info("Conversation deleted", { userId, conversationId: convId });
            return json(200, { deleted: true });
        }

        return json(405, { error: "Method not allowed" });
    } catch (error) {
        logger.error("Conversations API error", {
            error: error instanceof Error ? error.message : String(error),
        });
        return json(500, { error: "Internal server error" });
    }
};
