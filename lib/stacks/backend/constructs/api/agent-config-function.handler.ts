// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Logger } from "@aws-lambda-powertools/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    PutCommand,
    GetCommand,
    UpdateCommand,
    DeleteCommand,
    ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

const logger = new Logger({ serviceName: "agent-config-api" });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient());
const TABLE = process.env.AGENT_CONFIG_TABLE_NAME!;

const VALID_TOOL_SETS = new Set(["athena", "realtime", "schema", "graph", "entity_resolution"]);
const AGENT_ID_PATTERN = /^[a-zA-Z0-9_]+$/;

// DynamoDB cache TTL for agent configs (30 minutes in seconds)
const CACHE_TTL_SECONDS = 1800;

/** Compute expires_at as Unix epoch seconds, CACHE_TTL_SECONDS from now. */
function computeExpiresAt(): number {
    return Math.floor(Date.now() / 1000) + CACHE_TTL_SECONDS;
}

// CORS headers are handled by the Lambda Function URL configuration.
const responseHeaders = { "Content-Type": "application/json" };

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
    return { statusCode, headers: responseHeaders, body: JSON.stringify(body) };
}

interface AgentConfigBody {
    agent_id?: string;
    display_name?: string;
    description?: string;
    agent_type?: string;
    prompt_template?: string;
    model_key?: string;
    tool_sets?: string[];
    enabled?: boolean;
}

function validateCreate(body: AgentConfigBody): string | null {
    if (!body.agent_id || typeof body.agent_id !== "string") {
        return "agent_id is required";
    }
    if (!AGENT_ID_PATTERN.test(body.agent_id)) {
        return "agent_id must be alphanumeric with underscores only";
    }
    if (!body.display_name || typeof body.display_name !== "string" || !body.display_name.trim()) {
        return "display_name is required and must be non-empty";
    }
    if (!Array.isArray(body.tool_sets)) {
        return "tool_sets must be an array";
    }
    for (const ts of body.tool_sets) {
        if (!VALID_TOOL_SETS.has(ts)) {
            return `Invalid tool_set: "${ts}". Must be one of: ${[...VALID_TOOL_SETS].join(", ")}`;
        }
    }
    return null;
}

function validateUpdate(body: AgentConfigBody): string | null {
    if (body.display_name !== undefined) {
        if (typeof body.display_name !== "string" || !body.display_name.trim()) {
            return "display_name must be non-empty";
        }
    }
    if (body.tool_sets !== undefined) {
        if (!Array.isArray(body.tool_sets)) {
            return "tool_sets must be an array";
        }
        for (const ts of body.tool_sets) {
            if (!VALID_TOOL_SETS.has(ts)) {
                return `Invalid tool_set: "${ts}". Must be one of: ${[...VALID_TOOL_SETS].join(", ")}`;
            }
        }
    }
    return null;
}

/** Extract agent_id from path like /agents/my_agent */
function extractAgentId(path: string): string | null {
    const match = path.match(/^\/agents\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : null;
}

async function createAgent(body: AgentConfigBody): Promise<APIGatewayProxyResultV2> {
    const error = validateCreate(body);
    if (error) return json(400, { error });

    const now = new Date().toISOString();
    const item = {
        agent_id: body.agent_id!,
        display_name: body.display_name!.trim(),
        description: body.description || "",
        agent_type: body.agent_type || "",
        prompt_template: body.prompt_template || "",
        model_key: body.model_key || "",
        tool_sets: body.tool_sets!,
        enabled: body.enabled ?? true,
        created_at: now,
        updated_at: now,
        expires_at: computeExpiresAt(),
        source: "api",
    };

    try {
        await ddb.send(
            new PutCommand({
                TableName: TABLE,
                Item: item,
                ConditionExpression: "attribute_not_exists(agent_id)",
            })
        );
    } catch (err: unknown) {
        if (err instanceof Error && err.name === "ConditionalCheckFailedException") {
            return json(409, { error: `Agent with agent_id "${body.agent_id}" already exists` });
        }
        throw err;
    }

    logger.info("Agent config created", { agent_id: item.agent_id });
    return json(201, item);
}

async function listAgents(): Promise<APIGatewayProxyResultV2> {
    const result = await ddb.send(new ScanCommand({ TableName: TABLE }));
    return json(200, { agents: result.Items ?? [] });
}

async function getAgent(agentId: string): Promise<APIGatewayProxyResultV2> {
    const result = await ddb.send(new GetCommand({ TableName: TABLE, Key: { agent_id: agentId } }));
    if (!result.Item) return json(404, { error: `Agent "${agentId}" not found` });
    return json(200, result.Item);
}

async function updateAgent(
    agentId: string,
    body: AgentConfigBody
): Promise<APIGatewayProxyResultV2> {
    const error = validateUpdate(body);
    if (error) return json(400, { error });

    // Verify the agent exists first
    const existing = await ddb.send(
        new GetCommand({ TableName: TABLE, Key: { agent_id: agentId } })
    );
    if (!existing.Item) return json(404, { error: `Agent "${agentId}" not found` });

    const now = new Date().toISOString();
    const updates: string[] = ["#updated_at = :updated_at", "#expires_at = :expires_at"];
    const names: Record<string, string> = {
        "#updated_at": "updated_at",
        "#expires_at": "expires_at",
    };
    const values: Record<string, unknown> = {
        ":updated_at": now,
        ":expires_at": computeExpiresAt(),
    };

    const updatableFields = [
        "display_name",
        "description",
        "agent_type",
        "prompt_template",
        "model_key",
        "tool_sets",
        "enabled",
    ] as const;

    for (const field of updatableFields) {
        if (body[field] !== undefined) {
            const val =
                field === "display_name" && typeof body[field] === "string"
                    ? (body[field] as string).trim()
                    : body[field];
            updates.push(`#${field} = :${field}`);
            names[`#${field}`] = field;
            values[`:${field}`] = val;
        }
    }

    const result = await ddb.send(
        new UpdateCommand({
            TableName: TABLE,
            Key: { agent_id: agentId },
            UpdateExpression: `SET ${updates.join(", ")}`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
            ReturnValues: "ALL_NEW",
        })
    );

    logger.info("Agent config updated", { agent_id: agentId });
    return json(200, result.Attributes);
}

async function deleteAgent(agentId: string): Promise<APIGatewayProxyResultV2> {
    // Verify the agent exists first
    const existing = await ddb.send(
        new GetCommand({ TableName: TABLE, Key: { agent_id: agentId } })
    );
    if (!existing.Item) return json(404, { error: `Agent "${agentId}" not found` });

    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { agent_id: agentId } }));
    logger.info("Agent config deleted", { agent_id: agentId });
    return json(200, { deleted: true, agent_id: agentId });
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const method = event.requestContext.http.method;
    const path = event.requestContext.http.path;

    // OPTIONS preflight is handled by Lambda Function URL CORS config
    if (method === "OPTIONS") return json(200, {});

    try {
        const agentId = extractAgentId(path);

        // POST /agents — create agent config
        if (method === "POST" && path === "/agents") {
            const body = JSON.parse(event.body || "{}") as AgentConfigBody;
            return await createAgent(body);
        }

        // GET /agents — list all agent configs
        if (method === "GET" && path === "/agents") {
            return await listAgents();
        }

        // GET /agents/{agent_id} — get single agent config
        if (method === "GET" && agentId) {
            return await getAgent(agentId);
        }

        // PUT /agents/{agent_id} — update agent config
        if (method === "PUT" && agentId) {
            const body = JSON.parse(event.body || "{}") as AgentConfigBody;
            return await updateAgent(agentId, body);
        }

        // DELETE /agents/{agent_id} — delete agent config
        if (method === "DELETE" && agentId) {
            return await deleteAgent(agentId);
        }

        return json(405, { error: "Method not allowed" });
    } catch (err) {
        logger.error("Config API error", {
            error: err instanceof Error ? err.message : String(err),
        });
        return json(500, { error: "Internal server error" });
    }
};
