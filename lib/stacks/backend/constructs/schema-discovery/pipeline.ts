// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { AttributeType, TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { ISecurityGroup, IVpc, SubnetType } from "aws-cdk-lib/aws-ec2";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Runtime, Architecture } from "aws-cdk-lib/aws-lambda";
import { PythonFunction } from "@aws-cdk/aws-lambda-python-alpha";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";
import { join } from "path";

export interface SchemaPipelineProps {
    rawBucket: Bucket;
    docsBucket: Bucket;
    schemaKnowledgeBaseId: string;
    /** Bedrock model ID for the schema agent, sourced from cdk.json modelConfig. */
    modelId: string;
    /** Neptune cluster endpoint hostname */
    neptuneEndpoint?: string;
    /** VPC for deploying the hydration Lambda */
    vpc: IVpc;
    /** Security group for the hydration Lambda to access Neptune */
    runtimeSecurityGroup: ISecurityGroup;
    /** Neptune cluster ARN for scoping neptune-db data access */
    neptuneClusterArn: string;
}

export class SchemaPipeline extends Construct {
    public readonly schemaAgent: PythonFunction;
    public readonly hydrationFunction: PythonFunction;

    constructor(scope: Construct, id: string, props: SchemaPipelineProps) {
        super(scope, id);

        const { rawBucket, docsBucket, schemaKnowledgeBaseId } = props;

        const modelId = props.modelId;
        const region = Stack.of(this).region;
        const account = Stack.of(this).account;
        const bedrockModelResources = [
            `arn:aws:bedrock:*::foundation-model/${modelId.replace("us.", "")}`,
            `arn:aws:bedrock:*::foundation-model/${modelId}`,
            `arn:aws:bedrock:${region}:${account}:inference-profile/${modelId}`,
        ];

        // ── DynamoDB: Hydration State ──────────────────────────────────
        const hydrationTable = new TableV2(this, "HydrationState", {
            partitionKey: { name: "pk", type: AttributeType.STRING },
            removalPolicy: RemovalPolicy.DESTROY,
        });

        // ── Seed docs bucket with schema docs for Neptune graph sync ───
        new BucketDeployment(this, "SeedSchemaDocs", {
            sources: [
                Source.asset(
                    join(__dirname, "..", "..", "..", "..", "..", "data", "kb-schema-docs")
                ),
            ],
            destinationBucket: docsBucket,
        });

        // ── Schema Agent Lambda ────────────────────────────────────────
        this.schemaAgent = new PythonFunction(this, "schemaAgent", {
            entry: join(__dirname, "runtime", "schema"),
            index: "index.py",
            handler: "handler",
            runtime: Runtime.PYTHON_3_13,
            architecture: Architecture.ARM_64,
            timeout: Duration.minutes(15),
            memorySize: 1024,
            environment: {
                RAW_BUCKET: rawBucket.bucketName,
                DOCS_BUCKET: docsBucket.bucketName,
                BEDROCK_MODEL_ID: modelId,
            },
        });

        // Schema Agent permissions: S3 read raw, S3 write docs, Bedrock InvokeModel
        rawBucket.grantRead(this.schemaAgent);
        docsBucket.grantReadWrite(this.schemaAgent);

        this.schemaAgent.addToRolePolicy(
            new PolicyStatement({
                sid: "BedrockInvokeModel",
                effect: Effect.ALLOW,
                actions: ["bedrock:InvokeModel"],
                resources: bedrockModelResources,
            })
        );

        // ── Hydration Lambda ───────────────────────────────────────────
        this.hydrationFunction = new PythonFunction(this, "hydrationFunction", {
            entry: join(__dirname, "runtime", "hydration"),
            index: "index.py",
            handler: "handler",
            runtime: Runtime.PYTHON_3_13,
            architecture: Architecture.ARM_64,
            timeout: Duration.minutes(5),
            memorySize: 512,
            vpc: props.vpc,
            vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
            securityGroups: [props.runtimeSecurityGroup],
            environment: {
                DOCS_BUCKET: docsBucket.bucketName,
                SCHEMA_KB_ID: schemaKnowledgeBaseId,
                HYDRATION_TABLE: hydrationTable.tableName,
                BEDROCK_MODEL_ID: modelId,
                NEPTUNE_ENDPOINT_SSM_PARAM: "/liveops/neptune/endpoint",
            },
        });

        // Hydration permissions: S3 read docs, DynamoDB read/write, Bedrock StartIngestionJob
        docsBucket.grantRead(this.hydrationFunction);
        hydrationTable.grantReadWriteData(this.hydrationFunction);

        // Neptune access for graph sync
        this.hydrationFunction.addToRolePolicy(
            new PolicyStatement({
                sid: "NeptuneAccess",
                effect: Effect.ALLOW,
                actions: ["neptune-db:*"],
                resources: [props.neptuneClusterArn],
            })
        );

        // SSM read permission to resolve Neptune endpoint at runtime
        this.hydrationFunction.addToRolePolicy(
            new PolicyStatement({
                sid: "SSMNeptuneEndpoint",
                effect: Effect.ALLOW,
                actions: ["ssm:GetParameter"],
                resources: [
                    `arn:aws:ssm:${Stack.of(this).region}:${Stack.of(this).account}:parameter/liveops/*`,
                ],
            })
        );

        this.hydrationFunction.addToRolePolicy(
            new PolicyStatement({
                sid: "BedrockInvokeModel",
                effect: Effect.ALLOW,
                actions: ["bedrock:InvokeModel"],
                resources: bedrockModelResources,
            })
        );

        this.hydrationFunction.addToRolePolicy(
            new PolicyStatement({
                sid: "BedrockStartIngestionJob",
                effect: Effect.ALLOW,
                actions: ["bedrock:StartIngestionJob", "bedrock:ListDataSources"],
                resources: [`arn:aws:bedrock:${region}:${account}:knowledge-base/*`],
            })
        );

        // ── EventBridge: S3 Object Created → Schema Agent ─────────────
        new Rule(this, "RawSchemaUploadRule", {
            eventPattern: {
                source: ["aws.s3"],
                detailType: ["Object Created"],
                detail: {
                    bucket: {
                        name: [rawBucket.bucketName],
                    },
                },
            },
            targets: [new LambdaFunction(this.schemaAgent)],
        });

        // ── EventBridge: Daily schedule → Hydration Lambda ─────────────
        new Rule(this, "DailyHydrationRule", {
            schedule: Schedule.rate(Duration.days(1)),
            targets: [new LambdaFunction(this.hydrationFunction)],
        });

        // ── cdk-nag suppressions ───────────────────────────────────────
        NagSuppressions.addResourceSuppressions(
            [this.schemaAgent, this.hydrationFunction],
            [
                {
                    id: "AwsSolutions-L1",
                    reason: "Python 3.13 is the latest supported runtime for PythonFunction",
                },
            ],
            true
        );

        NagSuppressions.addResourceSuppressions(
            [this.schemaAgent],
            [
                {
                    id: "AwsSolutions-IAM5",
                    reason: "S3 read/write grants use wildcard for object keys within scoped buckets",
                },
            ],
            true
        );

        NagSuppressions.addResourceSuppressions(
            [this.hydrationFunction],
            [
                {
                    id: "AwsSolutions-IAM5",
                    reason: "S3 read grant uses wildcard for object keys within scoped docs bucket",
                },
            ],
            true
        );
    }
}
