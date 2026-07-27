// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { CfnOutput, Duration, StackProps, Stage } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Stack } from "../../common/constructs/stack";
import { DEFAULT_MODEL_ID } from "../../common/utilities";
import { Agents } from "./constructs/agents";
import { Api } from "./constructs/api";
import { Database } from "./constructs/database";
import { Networking } from "./constructs/networking";

import { Auth } from "./constructs/auth";
import { KnowledgeBase } from "./constructs/knowledge-base";
import { Memory } from "./constructs/memory";
import { RealtimeMonitor } from "./constructs/realtime-monitor";
import { Analytics } from "./constructs/analytics";
import { NeptuneServerless } from "./constructs/neptune";
import { SchemaIngest } from "./constructs/schema-discovery/ingest";
import { SchemaPipeline } from "./constructs/schema-discovery/pipeline";
import { DemoHeartbeat, DemoHeartbeatConfig } from "./constructs/demo-heartbeat";

export interface BrandingConfig {
    appTitle: string;
    logoUrl: string;
    faviconUrl: string;
    primaryColor: string;
    domainLabel: string;
}

export const DEFAULT_BRANDING: BrandingConfig = {
    appTitle: "Agentic Live Ops",
    logoUrl: "/favicon.png",
    faviconUrl: "/aws-smile.svg",
    primaryColor: "#0972d3",
    domainLabel: "liveops",
};

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validateAndMergeBranding(context: any): BrandingConfig {
    if (context == null) {
        return { ...DEFAULT_BRANDING };
    }

    if (typeof context !== "object" || Array.isArray(context)) {
        throw new Error("Invalid branding: must be an object");
    }

    // Validate appTitle
    if (context.appTitle !== undefined) {
        if (typeof context.appTitle !== "string" || context.appTitle.trim() === "") {
            throw new Error("Invalid branding.appTitle: must be a non-empty string");
        }
    }

    // Validate primaryColor
    if (context.primaryColor !== undefined) {
        if (
            typeof context.primaryColor !== "string" ||
            !HEX_COLOR_REGEX.test(context.primaryColor)
        ) {
            throw new Error(
                "Invalid branding.primaryColor: must be a CSS hex color (#RGB or #RRGGBB)"
            );
        }
    }

    // Validate logoUrl
    if (context.logoUrl !== undefined) {
        if (typeof context.logoUrl !== "string" || context.logoUrl.trim() === "") {
            throw new Error("Invalid branding.logoUrl: must be a non-empty string");
        }
    }

    // Validate faviconUrl
    if (context.faviconUrl !== undefined) {
        if (typeof context.faviconUrl !== "string" || context.faviconUrl.trim() === "") {
            throw new Error("Invalid branding.faviconUrl: must be a non-empty string");
        }
    }

    // Validate domainLabel
    if (context.domainLabel !== undefined) {
        if (typeof context.domainLabel !== "string" || context.domainLabel.trim() === "") {
            throw new Error("Invalid branding.domainLabel: must be a non-empty string");
        }
    }

    // Deep merge: deployer values win over defaults
    return {
        ...DEFAULT_BRANDING,
        ...context,
    };
}

interface BackendProps extends StackProps {
    urls: string[];
}

export class Backend extends Stack {
    public readonly environmentVariables: Record<string, string>;
    public readonly mergedBranding: BrandingConfig;

    constructor(scope: Construct, id: string, props: BackendProps) {
        super(scope, id, props);

        const { urls } = props;

        const mergedBranding = validateAndMergeBranding(this.node.tryGetContext("branding"));
        this.mergedBranding = mergedBranding;

        const networking = new Networking(this, "networking");

        const neptune = new NeptuneServerless(this, "neptune", {
            vpc: networking.vpc,
            databaseSecurityGroup: networking.databaseSecurityGroup,
            runtimeSecurityGroup: networking.runtimeSecurityGroup,
        });

        const database = new Database(this, "database");

        const auth = new Auth(this, "auth", {
            urls,
        });

        const modelConfig = this.node.tryGetContext("modelConfig") as
            | Record<string, unknown>
            | undefined;
        // cdk.json is the source of truth; fall back to the single shared default only if absent.
        const defaultModelId = (modelConfig?.defaultModelId as string) ?? DEFAULT_MODEL_ID;
        const modelConfigAgents = modelConfig?.agents as Record<string, string> | undefined;
        // Model for the real-time monitor's analysis runner, resolved from central config.
        const realtimeMonitorModelId = modelConfigAgents?.realtime_monitor ?? defaultModelId;

        // Knowledge base for analytics data
        const knowledgeBase = new KnowledgeBase(this, "knowledgeBase", {
            urls,
            queryModelId: defaultModelId,
            reportsTable: database.reportsTable,
            metricsSummaryTable: database.metricsSummaryTable,
            liveMetricsTable: database.liveMetricsTable,
        });

        // Knowledge base for remediation playbooks
        const remediationsKb = new KnowledgeBase(this, "remediationsKb", {
            urls,
            queryModelId: defaultModelId,
            dataAssetPath: "data/kb-remediations",
        });

        // Create short-term memory for agent conversations
        new Memory(this, "memory", {
            memoryName: "LiveOpsIntelligenceMemory",
            description: "Short-term memory for intelligence agent conversations",
            expirationDuration: Duration.days(7),
        });

        // Analytics: Glue catalog + Athena for structured data queries
        // Table definitions are driven from cdk.json context.analytics.tables
        const analyticsCtx = this.node.tryGetContext("analytics") as
            | { databaseName?: string; tables?: unknown[] }
            | undefined;
        if (!analyticsCtx?.tables?.length) {
            throw new Error(
                "cdk.json must define context.analytics.tables with at least one table definition"
            );
        }
        const analytics = new Analytics(this, "analytics", {
            dataBucket: knowledgeBase.dataBucket,
            tables: analyticsCtx.tables as import("./constructs/analytics").TableDef[],
            databaseName: analyticsCtx.databaseName,
        });

        // Schema discovery pipeline
        const schemaIngest = new SchemaIngest(this, "schemaIngest");

        const schemaKb = new KnowledgeBase(this, "schemaKb", {
            urls,
            queryModelId: defaultModelId,
            dataAssetPath: "data/kb-schema-docs",
        });

        // Schema discovery pipeline — constructs EventBridge rules as side effects
        new SchemaPipeline(this, "schemaPipeline", {
            rawBucket: schemaIngest.rawBucket,
            docsBucket: schemaIngest.docsBucket,
            schemaKnowledgeBaseId: schemaKb.knowledgeBase.attrKnowledgeBaseId,
            modelId: defaultModelId,
            vpc: networking.vpc,
            runtimeSecurityGroup: networking.runtimeSecurityGroup,
            neptuneClusterArn: neptune.clusterArn,
        });

        const agents = new Agents(this, "agents", {
            vpc: networking.vpc,
            runtimeSecurityGroup: networking.runtimeSecurityGroup,
            eventsTable: database.eventsTable,
            knowledgeBaseId: knowledgeBase.knowledgeBase.attrKnowledgeBaseId,
            memoryName: "LiveOpsIntelligenceMemory",
            liveMetricsTable: database.liveMetricsTable,
            reportsTable: database.reportsTable,
            athenaDatabase: analytics.databaseName,
            athenaWorkgroup: analytics.workgroupName,
            athenaResultsBucket: analytics.resultsBucketName,
            athenaDataBucketArn: analytics.dataBucketArn,
            domainLabel: mergedBranding.domainLabel,
            schemaKnowledgeBaseId: schemaKb.knowledgeBase.attrKnowledgeBaseId,
            agentConfigTable: database.agentConfigTable,
            neptuneClusterArn: neptune.clusterArn,
        });

        // Real-time game event monitoring pipeline
        const realtimeMonitor = new RealtimeMonitor(this, "realtimeMonitor", {
            liveMetricsTable: database.liveMetricsTable,
            reportsTable: database.reportsTable,
            patternRulesTable: database.patternRulesTable,
            metricsSummaryTable: database.metricsSummaryTable,
            knowledgeBaseId: knowledgeBase.knowledgeBase.attrKnowledgeBaseId,
            remediationsKnowledgeBaseId: remediationsKb.knowledgeBase.attrKnowledgeBaseId,
            athenaDatabase: analytics.databaseName,
            athenaWorkgroup: analytics.workgroupName,
            athenaResultsBucket: analytics.resultsBucketName,
            athenaDataBucketArn: analytics.dataBucketArn,
            dataBucketName: knowledgeBase.dataBucket.bucketName,
            modelId: realtimeMonitorModelId,
        });

        // Export Kinesis stream name for game client event ingestion
        new CfnOutput(this, "GameEventStreamName", {
            value: realtimeMonitor.gameEventStream.streamName,
            description: "Kinesis stream for real-time game event ingestion",
        });

        // Optional demo heartbeat — continuously pushes synthetic events for live dashboard demos
        const demoHeartbeatCtx = this.node.tryGetContext("demoHeartbeat") as
            | DemoHeartbeatConfig
            | undefined;

        const api = new Api(this, "api", {
            agentRuntime: agents.runtime,
            eventsTable: database.eventsTable,
            liveMetricsTable: database.liveMetricsTable,
            reportsTable: database.reportsTable,
            metricsSummaryTable: database.metricsSummaryTable,
            patternRulesTable: database.patternRulesTable,
            conversationsTable: database.conversationsTable,
            agentConfigTable: database.agentConfigTable,
            analysisRunnerFunction: realtimeMonitor.analysisRunnerFunction,
            urls,
        });
        // Grant Cognito Identity Pool roles permission to invoke the function URL
        api.functionUrl.grantInvokeUrl(auth.identityPool.authenticatedRole);
        api.functionUrl.grantInvokeUrl(auth.identityPool.unauthenticatedRole);
        api.monitorFunctionUrl.grantInvokeUrl(auth.identityPool.authenticatedRole);
        api.monitorFunctionUrl.grantInvokeUrl(auth.identityPool.unauthenticatedRole);
        api.conversationsFunctionUrl.grantInvokeUrl(auth.identityPool.authenticatedRole);
        api.configFunctionUrl.grantInvokeUrl(auth.identityPool.authenticatedRole);

        // Wire demo heartbeat after api is constructed so setDemoScenarioParam can be called
        if (demoHeartbeatCtx?.enabled) {
            const heartbeat = new DemoHeartbeat(this, "demoHeartbeat", {
                gameEventStream: realtimeMonitor.gameEventStream,
                config: demoHeartbeatCtx,
            });
            api.setDemoScenarioParam(heartbeat.scenarioParameter);
        }

        // Export Lambda Function URL for authenticated API calls
        // Uses Cognito Identity Pool credentials for IAM authentication
        new CfnOutput(this, "StreamFunctionUrl", {
            value: api.functionUrl.url,
            description: "Lambda Function URL with IAM auth",
        });

        this.environmentVariables = {
            VITE_REGION: this.region!,
            VITE_STAGE: Stage.of(this)?.stageName || "",
            VITE_BUILD_VERSION: process.env.npm_package_version || "",
            VITE_CALLBACK_URL: urls[0],
            VITE_USER_POOL_ID: auth.userPool.userPoolId,
            ...(auth.userPoolDomain && {
                VITE_USER_POOL_DOMAIN_URL: auth.userPoolDomain.baseUrl().replace("https://", ""),
            }),
            VITE_USER_POOL_CLIENT_ID: auth.userPoolClient.userPoolClientId,
            VITE_IDENTITY_POOL_ID: auth.identityPool.identityPoolId,
            // Use Lambda Function URL directly for authenticated requests (IAM signature validation)
            // CloudFront can't forward IAM-signed requests properly since signature is domain-specific
            VITE_STREAM_FUNCTION_URL: api.functionUrl.url,
            VITE_MONITOR_FUNCTION_URL: api.monitorFunctionUrl.url,
            VITE_CONVERSATIONS_FUNCTION_URL: api.conversationsFunctionUrl.url,
            VITE_CONFIG_FUNCTION_URL: api.configFunctionUrl.url,
            VITE_BRANDING_CONFIG: JSON.stringify(mergedBranding),
        };
    }
}
