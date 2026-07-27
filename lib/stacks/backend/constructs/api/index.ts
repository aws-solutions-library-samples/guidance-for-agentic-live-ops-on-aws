// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as agentcore from "@aws-cdk/aws-bedrock-agentcore-alpha";
import { Duration } from "aws-cdk-lib";
import { TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { FunctionUrl, HttpMethod, IFunction, InvokeMode, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { IStringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { join } from "path";
import { AgentConfigFunction } from "./agent-config-function";

export interface ApiProps {
    agentRuntime: agentcore.Runtime;
    eventsTable: TableV2;
    liveMetricsTable: TableV2;
    reportsTable: TableV2;
    metricsSummaryTable: TableV2;
    patternRulesTable: TableV2;
    conversationsTable: TableV2;
    agentConfigTable: TableV2;
    analysisRunnerFunction: IFunction;
    urls: string[];
}

export class Api extends Construct {
    public readonly functionUrl: FunctionUrl;
    public readonly monitorFunctionUrl: FunctionUrl;
    public readonly conversationsFunctionUrl: FunctionUrl;
    public readonly configFunctionUrl: FunctionUrl;
    private readonly monitorFunction: NodejsFunction;

    constructor(scope: Construct, id: string, props: ApiProps) {
        super(scope, id);

        const {
            agentRuntime,
            eventsTable,
            liveMetricsTable,
            reportsTable,
            metricsSummaryTable,
            patternRulesTable,
            conversationsTable,
            agentConfigTable,
            analysisRunnerFunction,
            urls,
        } = props;

        // Note: REST API removed - using direct streaming via Lambda Function URL only

        const streamFunction = new NodejsFunction(this, "streamFunction", {
            entry: join(__dirname, "stream-function.ts"),
            runtime: Runtime.NODEJS_22_X,
            timeout: Duration.minutes(15),
            memorySize: 1024,
            environment: {
                LOG_LEVEL: "INFO",
                AGENT_RUNTIME_ARN: agentRuntime.agentRuntimeArn,
                EVENTS_TABLE_NAME: eventsTable.tableName,
                ALLOWED_ORIGINS: JSON.stringify(urls),
            },
            bundling: {
                externalModules: ["@aws-sdk/*"],
            },
        });
        eventsTable.grantWriteData(streamFunction);
        // Grant permission to invoke the runtime directly via AgentCore
        streamFunction.addToRolePolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["bedrock-agentcore:InvokeAgentRuntime"],
                resources: [agentRuntime.agentRuntimeArn, `${agentRuntime.agentRuntimeArn}/*`],
            })
        );

        const functionUrl = streamFunction.addFunctionUrl({
            invokeMode: InvokeMode.RESPONSE_STREAM,
            authType: lambda.FunctionUrlAuthType.AWS_IAM, // Use IAM auth with Cognito Identity Pool
            cors: {
                allowedOrigins: urls,
                allowedMethods: [HttpMethod.POST],
                allowedHeaders: [
                    "Content-Type",
                    "Authorization",
                    "X-Amz-Date",
                    "X-Amz-Security-Token",
                    "X-Amz-User-Agent",
                    "X-Amz-Content-Sha256",
                ],
                allowCredentials: true,
                maxAge: Duration.minutes(5),
            },
        });

        // Note: WAF association removed - Lambda Function URLs don't support direct WAF association
        // Consider using CloudFront in front of the function URL if WAF protection is needed

        // Monitor API — lightweight read-only endpoint for the real-time panel
        const monitorFunction = new NodejsFunction(this, "monitorFunction", {
            entry: join(__dirname, "monitor-function.ts"),
            runtime: Runtime.NODEJS_22_X,
            timeout: Duration.seconds(10),
            memorySize: 256,
            environment: {
                LIVE_METRICS_TABLE: liveMetricsTable.tableName,
                METRICS_SUMMARY_TABLE: metricsSummaryTable.tableName,
                REPORTS_TABLE: reportsTable.tableName,
                PATTERN_RULES_TABLE: patternRulesTable.tableName,
                ANALYSIS_RUNNER_FUNCTION: analysisRunnerFunction.functionName,
                ALLOWED_ORIGINS: JSON.stringify(urls),
            },
            bundling: {
                externalModules: ["@aws-sdk/*"],
            },
        });
        liveMetricsTable.grantReadData(monitorFunction);
        metricsSummaryTable.grantReadData(monitorFunction);
        reportsTable.grantReadData(monitorFunction);
        patternRulesTable.grantReadWriteData(monitorFunction);

        // Allow monitor function to invoke the analysis runner
        analysisRunnerFunction.grantInvoke(monitorFunction);

        const monitorUrl = monitorFunction.addFunctionUrl({
            authType: lambda.FunctionUrlAuthType.AWS_IAM,
            cors: {
                allowedOrigins: urls,
                allowedMethods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.POST],
                allowedHeaders: [
                    "Content-Type",
                    "Authorization",
                    "X-Amz-Date",
                    "X-Amz-Security-Token",
                    "X-Amz-User-Agent",
                    "X-Amz-Content-Sha256",
                ],
                allowCredentials: true,
                maxAge: Duration.minutes(5),
            },
        });

        this.functionUrl = functionUrl;
        this.monitorFunctionUrl = monitorUrl;
        this.monitorFunction = monitorFunction;

        // Conversations API — CRUD for saved chat history per user
        const conversationsFunction = new NodejsFunction(this, "conversationsFunction", {
            entry: join(__dirname, "conversations-function.ts"),
            runtime: Runtime.NODEJS_22_X,
            timeout: Duration.seconds(10),
            memorySize: 256,
            environment: {
                CONVERSATIONS_TABLE_NAME: conversationsTable.tableName,
                ALLOWED_ORIGINS: JSON.stringify(urls),
            },
            bundling: {
                externalModules: ["@aws-sdk/*"],
            },
        });
        conversationsTable.grantReadWriteData(conversationsFunction);

        const conversationsUrl = conversationsFunction.addFunctionUrl({
            authType: lambda.FunctionUrlAuthType.AWS_IAM,
            cors: {
                allowedOrigins: urls,
                allowedMethods: [HttpMethod.GET, HttpMethod.POST, HttpMethod.DELETE],
                allowedHeaders: [
                    "Content-Type",
                    "Authorization",
                    "X-Amz-Date",
                    "X-Amz-Security-Token",
                    "X-Amz-User-Agent",
                    "X-Amz-Content-Sha256",
                ],
                allowCredentials: true,
                maxAge: Duration.minutes(5),
            },
        });

        this.conversationsFunctionUrl = conversationsUrl;

        // Agent Config API — CRUD for dynamic agent configurations
        const agentConfigFunction = new AgentConfigFunction(this, "agentConfigFunction", {
            agentConfigTable,
            urls,
        });

        this.configFunctionUrl = agentConfigFunction.configFunctionUrl;
    }

    /**
     * Called after construction when the demo heartbeat is enabled.
     * Grants the monitor function read/write access to the SSM scenario parameter
     * and injects the parameter name as an env var so the /demo/scenario route works.
     */
    setDemoScenarioParam(scenarioParameter: IStringParameter): void {
        // Scoped to the specific demo scenario parameter only
        scenarioParameter.grantRead(this.monitorFunction);
        scenarioParameter.grantWrite(this.monitorFunction);
        this.monitorFunction.addEnvironment("DEMO_SCENARIO_PARAM", scenarioParameter.parameterName);
    }
}
