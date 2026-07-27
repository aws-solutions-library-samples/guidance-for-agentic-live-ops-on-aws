// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
    AgentRuntimeArtifact,
    ProtocolType,
    Runtime,
    RuntimeAuthorizerConfiguration,
    RuntimeNetworkConfiguration,
} from "@aws-cdk/aws-bedrock-agentcore-alpha";
import { ContentFilterStrength, ContentFilterType, Guardrail } from "@aws-cdk/aws-bedrock-alpha";
import { Names, RemovalPolicy, Stack } from "aws-cdk-lib";
import { TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { ISecurityGroup, IVpc, SubnetType } from "aws-cdk-lib/aws-ec2";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { join } from "path";
import { DEFAULT_MODEL_ID } from "../../../../common/utilities";

export interface AgentsProps {
    vpc: IVpc;
    runtimeSecurityGroup: ISecurityGroup;
    eventsTable: TableV2;
    knowledgeBaseId: string;
    memoryName: string;
    liveMetricsTable: TableV2;
    reportsTable: TableV2;
    athenaDatabase: string;
    athenaWorkgroup: string;
    athenaResultsBucket: string;
    athenaDataBucketArn: string;
    domainLabel: string;
    schemaKnowledgeBaseId: string;
    agentConfigTable: TableV2;
    neptuneClusterArn: string;
}

export class Agents extends Construct {
    public readonly runtime: Runtime;

    constructor(scope: Construct, id: string, props: AgentsProps) {
        super(scope, id);

        const {
            vpc,
            runtimeSecurityGroup,
            eventsTable,
            knowledgeBaseId,
            memoryName,
            liveMetricsTable,
            reportsTable,
            athenaDatabase,
            athenaWorkgroup,
            athenaResultsBucket,
            athenaDataBucketArn,
            schemaKnowledgeBaseId,
            agentConfigTable,
            neptuneClusterArn,
        } = props;

        // Read per-agent model configuration from cdk.json context
        const modelConfig = this.node.tryGetContext("modelConfig") ?? {};
        const defaultModelId = modelConfig.defaultModelId ?? DEFAULT_MODEL_ID;

        // S3 bucket for agent configs — the source of truth for dynamic agents.
        // Convention: each agent is a folder with config.json + prompt.md
        // Operators can drop new agent folders into S3 to add agents without redeploying.
        const agentConfigBucket = new Bucket(this, "agentConfigBucket", {
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        NagSuppressions.addResourceSuppressions(agentConfigBucket, [
            {
                id: "AwsSolutions-S1",
                reason: "Agent config bucket contains non-sensitive prompt templates and metadata, access logs not required",
            },
            {
                id: "AwsSolutions-S10",
                reason: "SSL enforcement handled by IAM role permissions on the AgentCore runtime",
            },
        ]);

        // Seed the bucket with default agent configs from data/agent-configs/
        new BucketDeployment(this, "agentConfigSeed", {
            sources: [
                Source.asset(
                    join(__dirname, "..", "..", "..", "..", "..", "data", "agent-configs")
                ),
            ],
            destinationBucket: agentConfigBucket,
            destinationKeyPrefix: "agents/",
            prune: false, // Don't delete operator-added agents on redeploy
        });

        const guardrail = new Guardrail(this, "guardrail", {
            guardrailName: Names.uniqueResourceName(this, { maxLength: 64 }),
            blockedInputMessaging: "Your input was blocked due to security policy violations.",
            blockedOutputsMessaging: "The response was blocked due to security policy violations.",
        });
        guardrail.addContentFilter({
            type: ContentFilterType.PROMPT_ATTACK,
            inputStrength: ContentFilterStrength.HIGH,
            outputStrength: ContentFilterStrength.NONE,
        });

        const runtime = new Runtime(this, "runtime", {
            runtimeName: Names.uniqueResourceName(this, { maxLength: 48 }),
            agentRuntimeArtifact: AgentRuntimeArtifact.fromAsset(join(__dirname, "runtime"), {
                platform: Platform.LINUX_ARM64,
            }),
            authorizerConfiguration: RuntimeAuthorizerConfiguration.usingIAM(),
            networkConfiguration: RuntimeNetworkConfiguration.usingVpc(this, {
                vpc,
                vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
                securityGroups: [runtimeSecurityGroup],
            }),
            environmentVariables: {
                LOG_LEVEL: "INFO",
                BEDROCK_KB_ID: knowledgeBaseId,
                BEDROCK_MEMORY_NAME: memoryName,
                BEDROCK_MODEL_ID: defaultModelId,
                BEDROCK_REGION: Stack.of(this).region,
                DOMAIN_LABEL: props.domainLabel,
                DISABLE_MEMORY: "false", // Set to "true" to disable memory for debugging

                // Force runtime redeployment when code changes
                RUNTIME_VERSION: new Date().toISOString().slice(0, 16),

                // Per-agent model config as JSON (resolved by runtime from cdk.json modelConfig)
                MODEL_CONFIG: JSON.stringify(modelConfig),

                // Enable AWS X-Ray tracing
                AWS_XRAY_TRACING_ENABLED: "true",
                AWS_XRAY_CONTEXT_MISSING: "LOG_ERROR",

                // Legacy variables (keeping for compatibility but not used in current runtime)
                GUARDRAIL_ID: guardrail.guardrailId,
                GUARDRAIL_VERSION: guardrail.guardrailVersion,
                EVENTS_TABLE_NAME: eventsTable.tableName,
                LIVE_METRICS_TABLE: liveMetricsTable.tableName,
                REPORTS_TABLE: reportsTable.tableName,

                // Athena analytics configuration
                ATHENA_DATABASE: athenaDatabase,
                ATHENA_WORKGROUP: athenaWorkgroup,
                ATHENA_RESULTS_BUCKET: athenaResultsBucket,

                // Schema discovery KB
                SCHEMA_KB_ID: schemaKnowledgeBaseId,

                // Neptune graph database — endpoint read from SSM at runtime to avoid CDK token circular dependency
                NEPTUNE_ENDPOINT_SSM_PARAM: "/liveops/neptune/endpoint",

                // Dynamic agent configuration table
                AGENT_CONFIG_TABLE: agentConfigTable.tableName,

                // S3 bucket for agent configs (source of truth — scanned on cache refresh)
                AGENT_CONFIG_BUCKET: agentConfigBucket.bucketName,
            },
            protocolConfiguration: ProtocolType.HTTP,
        });
        eventsTable.grantReadWriteData(runtime);
        liveMetricsTable.grantReadData(runtime);
        reportsTable.grantReadData(runtime);
        agentConfigTable.grantReadWriteData(runtime);
        agentConfigBucket.grantRead(runtime);
        guardrail.grantApply(runtime);
        // Remove MCP server runtime permissions - no longer needed
        runtime.addToRolePolicy(
            new PolicyStatement({
                sid: "BedrockModelInvocation",
                effect: Effect.ALLOW,
                actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
                resources: ["*"],
            })
        );

        // Athena + Glue + S3 permissions for structured data queries
        runtime.addToRolePolicy(
            new PolicyStatement({
                sid: "AthenaQueryAccess",
                effect: Effect.ALLOW,
                actions: [
                    "athena:StartQueryExecution",
                    "athena:GetQueryExecution",
                    "athena:GetQueryResults",
                    "athena:StopQueryExecution",
                    "athena:GetWorkGroup",
                ],
                resources: [
                    `arn:aws:athena:${Stack.of(this).region}:${Stack.of(this).account}:workgroup/*`,
                ],
            })
        );
        runtime.addToRolePolicy(
            new PolicyStatement({
                sid: "GlueCatalogAccess",
                effect: Effect.ALLOW,
                actions: [
                    "glue:GetDatabase",
                    "glue:GetTable",
                    "glue:GetTables",
                    "glue:GetPartitions",
                ],
                resources: [
                    `arn:aws:glue:${Stack.of(this).region}:${Stack.of(this).account}:catalog`,
                    `arn:aws:glue:${Stack.of(this).region}:${Stack.of(this).account}:database/*`,
                    `arn:aws:glue:${Stack.of(this).region}:${Stack.of(this).account}:table/*/*`,
                ],
            })
        );
        runtime.addToRolePolicy(
            new PolicyStatement({
                sid: "AthenaS3ResultsAccess",
                effect: Effect.ALLOW,
                actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket", "s3:GetBucketLocation"],
                resources: [
                    `arn:aws:s3:::${athenaResultsBucket}`,
                    `arn:aws:s3:::${athenaResultsBucket}/*`,
                ],
            })
        );
        runtime.addToRolePolicy(
            new PolicyStatement({
                sid: "AthenaS3DataAccess",
                effect: Effect.ALLOW,
                actions: ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"],
                resources: [athenaDataBucketArn, `${athenaDataBucketArn}/*`],
            })
        );

        runtime.addToRolePolicy(
            new PolicyStatement({
                sid: "AgentCoreMemoryAccess",
                effect: Effect.ALLOW,
                actions: [
                    "bedrock-agentcore:GetMemory",
                    "bedrock-agentcore:PutMemory",
                    "bedrock-agentcore:DeleteMemory",
                    "bedrock-agentcore:ListMemories",
                    "bedrock-agentcore:ListEvents",
                    "bedrock-agentcore:GetEvent",
                    "bedrock-agentcore:CreateEvent",
                    "bedrock-agentcore:UpdateEvent",
                    "bedrock-agentcore:DeleteEvent",
                ],
                resources: [
                    `arn:aws:bedrock-agentcore:${Stack.of(this).region}:${Stack.of(this).account}:memory/*`,
                    `arn:aws:bedrock-agentcore:${Stack.of(this).region}:${Stack.of(this).account}:memory-space/*`,
                ],
            })
        );

        runtime.addToRolePolicy(
            new PolicyStatement({
                sid: "BedrockKnowledgeBaseAccess",
                effect: Effect.ALLOW,
                actions: [
                    "bedrock:Retrieve",
                    "bedrock:RetrieveAndGenerate",
                    "bedrock:GetKnowledgeBase",
                ],
                resources: [
                    `arn:aws:bedrock:${Stack.of(this).region}:${Stack.of(this).account}:knowledge-base/*`,
                ],
            })
        );

        // Add CloudWatch Logs permissions
        runtime.addToRolePolicy(
            new PolicyStatement({
                sid: "CloudWatchLogsPermissions",
                effect: Effect.ALLOW,
                actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
                resources: ["*"],
            })
        );

        // Add Neptune graph database permissions
        runtime.addToRolePolicy(
            new PolicyStatement({
                sid: "NeptuneGraphAccess",
                effect: Effect.ALLOW,
                actions: ["neptune-db:*"],
                resources: [neptuneClusterArn],
            })
        );

        // SSM read permission to resolve Neptune endpoint at runtime
        runtime.addToRolePolicy(
            new PolicyStatement({
                sid: "SSMNeptuneEndpoint",
                effect: Effect.ALLOW,
                actions: ["ssm:GetParameter"],
                resources: [
                    `arn:aws:ssm:${Stack.of(this).region}:${Stack.of(this).account}:parameter/liveops/*`,
                ],
            })
        );

        this.runtime = runtime;
    }
}
