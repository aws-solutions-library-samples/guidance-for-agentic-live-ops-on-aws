// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Monitor API Lambda — returns live metrics and reports from DynamoDB
 * for the frontend real-time monitoring panel.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    ScanCommand,
    PutCommand,
    QueryCommand,
    UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { SSMClient, GetParameterCommand, PutParameterCommand } from "@aws-sdk/client-ssm";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient());

const METRICS_SUMMARY_TABLE = process.env.METRICS_SUMMARY_TABLE!;
const LIVE_METRICS_TABLE = process.env.LIVE_METRICS_TABLE!; // fallback
const REPORTS_TABLE = process.env.REPORTS_TABLE!;
const PATTERN_RULES_TABLE = process.env.PATTERN_RULES_TABLE!;
const ANALYSIS_RUNNER_FUNCTION = process.env.ANALYSIS_RUNNER_FUNCTION || "";
const DEMO_SCENARIO_PARAM = process.env.DEMO_SCENARIO_PARAM || "";
const lambdaClient = new LambdaClient();
const ssmClient = new SSMClient();
// CORS is handled by the Lambda Function URL configuration in CDK.
// Do NOT set Access-Control-Allow-Origin headers here — it causes duplicate header errors.
const responseHeaders = { "Content-Type": "application/json" };

interface MetricSummary {
    event_type: string;
    total: number;
    platforms: Record<string, number>;
    regions: Record<string, number>;
}

async function getLiveMetrics(): Promise<MetricSummary[]> {
    // Read from the pre-aggregated summary table — one row per event_type.
    // This is O(N) where N = number of distinct event types (typically < 20),
    // instead of scanning thousands of sliding-window rows.
    const result = await ddb.send(new ScanCommand({ TableName: METRICS_SUMMARY_TABLE }));
    const items = result.Items || [];

    return items
        .map((item) => ({
            event_type: item.event_type as string,
            total: Number(item.total || 0),
            platforms: (item.platforms as Record<string, number>) || {},
            regions: (item.regions as Record<string, number>) || {},
        }))
        .filter((m) => m.total > 0)
        .sort((a, b) => b.total - a.total);
}

interface Report {
    report_id: string;
    created_at: string;
    rule_id: string;
    event_type: string;
    analysis: string;
    trigger_context: string;
    severity?: string;
    current_count?: number;
    threshold?: number;
    artifacts?: string; // JSON string of { data_points, kb_sources }
}

async function getReports(limit: number = 10): Promise<Report[]> {
    // Query the GSI for most recent reports — avoids full table scan.
    // All reports share gsi_pk="ALL", sorted by created_at descending.
    const result = await ddb.send(
        new QueryCommand({
            TableName: REPORTS_TABLE,
            IndexName: "gsi-all-by-time",
            KeyConditionExpression: "gsi_pk = :pk",
            ExpressionAttributeValues: { ":pk": "ALL" },
            ScanIndexForward: false, // newest first
            Limit: limit,
        })
    );

    let items = (result.Items || []) as Record<string, unknown>[];

    // Fallback: if GSI returns nothing, scan for legacy reports missing gsi_pk
    // and backfill them so future queries use the GSI.
    if (items.length === 0) {
        const scanResult = await ddb.send(new ScanCommand({ TableName: REPORTS_TABLE }));
        items = ((scanResult.Items || []) as Record<string, unknown>[])
            .sort((a, b) =>
                ((b.created_at as string) || "").localeCompare((a.created_at as string) || "")
            )
            .slice(0, limit);

        // Backfill gsi_pk on legacy items so the GSI picks them up
        for (const item of items) {
            if (!item.gsi_pk) {
                await ddb.send(
                    new UpdateCommand({
                        TableName: REPORTS_TABLE,
                        Key: { report_id: item.report_id, created_at: item.created_at },
                        UpdateExpression: "SET gsi_pk = :pk",
                        ExpressionAttributeValues: { ":pk": "ALL" },
                    })
                );
            }
        }
    }

    return items.map((item) => ({
        report_id: item.report_id as string,
        created_at: item.created_at as string,
        rule_id: item.rule_id as string,
        event_type: item.event_type as string,
        analysis: item.analysis as string,
        trigger_context: item.trigger_context as string,
        severity: item.severity as string | undefined,
        current_count: item.current_count as number | undefined,
        threshold: item.threshold as number | undefined,
        artifacts: item.artifacts
            ? (() => {
                  try {
                      return JSON.parse(item.artifacts as string);
                  } catch {
                      return undefined;
                  }
              })()
            : undefined,
    }));
}

// 10-minute window size matching pattern_detector.py (used in metric_key format)
interface TimeSeriesBucket {
    timestamp: string; // ISO string for the bucket start
    event_type: string;
    count: number;
}

async function getTimeSeries(timeRangeMinutes: number = 60): Promise<TimeSeriesBucket[]> {
    // Query the GSI for dimension="total" — avoids full table scan.
    // The GSI SK is metric_key (e.g. "battle_error#1700000000").
    const result = await ddb.send(
        new QueryCommand({
            TableName: LIVE_METRICS_TABLE,
            IndexName: "gsi-dimension",
            KeyConditionExpression: "dimension = :dim",
            ExpressionAttributeValues: { ":dim": "total" },
        })
    );

    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - timeRangeMinutes * 60;
    const buckets: TimeSeriesBucket[] = [];

    for (const item of result.Items || []) {
        const metricKey = item.metric_key as string;
        const parts = metricKey.split("#");
        if (parts.length !== 2) continue;

        const eventType = parts[0];
        const bucketTs = parseInt(parts[1], 10);
        if (bucketTs < cutoff) continue;

        buckets.push({
            timestamp: new Date(bucketTs * 1000).toISOString(),
            event_type: eventType,
            count: Number(item.event_count || 0),
        });
    }

    buckets.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return buckets;
}

interface PatternRule {
    rule_id: string;
    event_type: string;
    threshold: number;
    window_minutes: number;
    description: string;
    analysis_prompt: string;
}

async function getRules(): Promise<PatternRule[]> {
    const result = await ddb.send(new ScanCommand({ TableName: PATTERN_RULES_TABLE }));
    return (result.Items || []) as PatternRule[];
}

async function putRule(rule: PatternRule): Promise<void> {
    await ddb.send(new PutCommand({ TableName: PATTERN_RULES_TABLE, Item: rule }));
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
    // OPTIONS preflight is handled automatically by Lambda Function URL CORS config
    if (event.requestContext?.http?.method === "OPTIONS") {
        return { statusCode: 200, body: "" };
    }

    try {
        const method = event.requestContext?.http?.method || "GET";
        const path = event.requestContext?.http?.path || "/";

        // GET /rules — return pattern rules
        if (method === "GET" && path.includes("/rules")) {
            const rules = await getRules();
            return { statusCode: 200, headers: responseHeaders, body: JSON.stringify({ rules }) };
        }

        // PUT /rules — update a pattern rule
        if (method === "PUT" && path.includes("/rules")) {
            const rule = JSON.parse(event.body || "{}") as PatternRule;
            if (!rule.rule_id || !rule.event_type || !rule.threshold) {
                return {
                    statusCode: 400,
                    headers: responseHeaders,
                    body: JSON.stringify({
                        error: "Missing required fields: rule_id, event_type, threshold",
                    }),
                };
            }
            await putRule(rule);
            return {
                statusCode: 200,
                headers: responseHeaders,
                body: JSON.stringify({ success: true, rule }),
            };
        }

        // POST /analyze — trigger analysis runner for a specific event type
        if (method === "POST" && path.includes("/analyze")) {
            if (!ANALYSIS_RUNNER_FUNCTION) {
                return {
                    statusCode: 400,
                    headers: responseHeaders,
                    body: JSON.stringify({ error: "Analysis runner not configured" }),
                };
            }
            const body = JSON.parse(event.body || "{}");
            const payload = {
                rule_id: body.rule_id || `${body.event_type}_manual`,
                event_type: body.event_type,
                current_count: body.current_count || 0,
                threshold: body.threshold || 0,
                description: body.description || `Manual analysis request for ${body.event_type}`,
                analysis_prompt:
                    body.analysis_prompt ||
                    `Analyze the current ${body.event_type} pattern. Check live metrics, identify affected platforms/regions, and recommend actions.`,
                window_minutes: body.window_minutes || 2,
                triggered_at: Date.now() / 1000,
            };

            await lambdaClient.send(
                new InvokeCommand({
                    FunctionName: ANALYSIS_RUNNER_FUNCTION,
                    InvocationType: "Event", // async
                    Payload: Buffer.from(JSON.stringify(payload)),
                })
            );

            return {
                statusCode: 202,
                headers: responseHeaders,
                body: JSON.stringify({
                    success: true,
                    message: "Analysis requested",
                    event_type: body.event_type,
                }),
            };
        }

        // GET /demo/scenario — return current demo scenario (only if heartbeat is configured)
        if (method === "GET" && path.includes("/demo/scenario")) {
            if (!DEMO_SCENARIO_PARAM) {
                return {
                    statusCode: 404,
                    headers: responseHeaders,
                    body: JSON.stringify({ error: "Demo heartbeat not enabled" }),
                };
            }
            const resp = await ssmClient.send(
                new GetParameterCommand({ Name: DEMO_SCENARIO_PARAM })
            );
            return {
                statusCode: 200,
                headers: responseHeaders,
                body: JSON.stringify({ scenario: resp.Parameter?.Value ?? "baseline" }),
            };
        }

        // POST /demo/scenario — update the active demo scenario
        if (method === "POST" && path.includes("/demo/scenario")) {
            if (!DEMO_SCENARIO_PARAM) {
                return {
                    statusCode: 404,
                    headers: responseHeaders,
                    body: JSON.stringify({ error: "Demo heartbeat not enabled" }),
                };
            }
            const { scenario } = JSON.parse(event.body || "{}");
            const valid = ["baseline", "spike", "purchase", "churn", "random"];
            if (!valid.includes(scenario)) {
                return {
                    statusCode: 400,
                    headers: responseHeaders,
                    body: JSON.stringify({
                        error: `Invalid scenario. Must be one of: ${valid.join(", ")}`,
                    }),
                };
            }
            await ssmClient.send(
                new PutParameterCommand({
                    Name: DEMO_SCENARIO_PARAM,
                    Value: scenario,
                    Overwrite: true,
                })
            );
            return {
                statusCode: 200,
                headers: responseHeaders,
                body: JSON.stringify({ scenario }),
            };
        }

        // Default: GET / — return metrics, reports, timeSeries
        const params = event.queryStringParameters || {};
        const reportLimit = parseInt(params.report_limit || "10", 10);
        const timeRange = parseInt(params.time_range || "60", 10);

        const [metrics, reports, timeSeries, rules] = await Promise.all([
            getLiveMetrics(),
            getReports(reportLimit),
            getTimeSeries(timeRange),
            getRules(),
        ]);

        return {
            statusCode: 200,
            headers: responseHeaders,
            body: JSON.stringify({
                metrics,
                reports,
                timeSeries,
                rules,
                timestamp: new Date().toISOString(),
            }),
        };
    } catch (err) {
        console.error("Monitor API error:", err);
        return {
            statusCode: 500,
            headers: responseHeaders,
            body: JSON.stringify({ error: "Internal server error" }),
        };
    }
}
