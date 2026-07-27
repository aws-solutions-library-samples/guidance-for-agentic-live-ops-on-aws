// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Duration, RemovalPolicy, Stack, CustomResource } from "aws-cdk-lib";
import { CfnKnowledgeBase, CfnDataSource } from "aws-cdk-lib/aws-bedrock";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Function as LambdaFunctionConstruct, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { PythonFunction } from "@aws-cdk/aws-lambda-python-alpha";
import { Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction as LambdaTarget } from "aws-cdk-lib/aws-events-targets";
import { Trigger } from "aws-cdk-lib/triggers";
import { TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";

export interface KnowledgeBaseProps {
    urls: string[];
    embeddingModel?: string;
    vectorDimensions?: number;
    /** Path to the local data directory to deploy as KB assets (default: "data/kb-insights/summaries") */
    dataAssetPath?: string;
    /** Model ID used by the KB query function for direct invocation (sourced from cdk.json defaultModelId) */
    queryModelId: string;
    // Optional: DynamoDB tables to export before rehydration
    reportsTable?: TableV2;
    metricsSummaryTable?: TableV2;
    liveMetricsTable?: TableV2;
}

export class KnowledgeBase extends Construct {
    public readonly knowledgeBase: CfnKnowledgeBase;
    public readonly dataSource: CfnDataSource;
    public readonly dataBucket: Bucket;
    public readonly vectorBucketName: string;
    public readonly vectorIndexName: string;
    public readonly queryFunction: LambdaFunctionConstruct;

    constructor(scope: Construct, id: string, props: KnowledgeBaseProps) {
        super(scope, id);

        const {
            embeddingModel = "amazon.titan-embed-text-v2:0",
            vectorDimensions = 1024,
            dataAssetPath = "data/kb-insights/summaries",
            queryModelId,
        } = props;
        // Create S3 bucket for data source (documents)
        this.dataBucket = new Bucket(this, "DataSourceBucket", {
            encryption: BucketEncryption.S3_MANAGED,
            versioned: true,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        // Generate unique names for vector bucket and index
        this.vectorBucketName = `knowledge-vectors-${Stack.of(this).account}-${Stack.of(this).region}-${id.toLowerCase()}`;
        this.vectorIndexName = "knowledge-base-index";

        // Create Lambda function for S3 Vector bucket management
        const vectorBucketHandler = new NodejsFunction(this, "VectorBucketHandler", {
            entry: "lib/stacks/backend/functions/s3-vectors-bucket/index.js",
            runtime: Runtime.NODEJS_20_X,
            handler: "handler",
            timeout: Duration.minutes(5),
            bundling: {
                externalModules: [],
            },
        });

        // Create Lambda function for S3 Vector index management
        const vectorIndexHandler = new NodejsFunction(this, "VectorIndexHandler", {
            entry: "lib/stacks/backend/functions/s3-vectors-index/index.js",
            runtime: Runtime.NODEJS_20_X,
            handler: "handler",
            timeout: Duration.minutes(5),
            bundling: {
                externalModules: [],
            },
        });

        // Create Lambda function for Bedrock Knowledge Base management
        const knowledgeBaseHandler = new NodejsFunction(this, "KnowledgeBaseHandler", {
            entry: "lib/stacks/backend/functions/bedrock-knowledge-base/index.js",
            runtime: Runtime.NODEJS_20_X,
            handler: "handler",
            timeout: Duration.minutes(15), // Longer timeout for KB operations
            bundling: {
                externalModules: [],
            },
        });

        // Grant S3 Vectors permissions to the bucket handler
        vectorBucketHandler.addToRolePolicy(
            new PolicyStatement({
                actions: [
                    "s3vectors:CreateVectorBucket",
                    "s3vectors:DeleteVectorBucket",
                    "s3vectors:GetVectorBucket",
                    "s3vectors:ListVectorBuckets",
                    "s3vectors:ListIndexes",
                    "s3vectors:DeleteIndex",
                ],
                resources: ["*"],
            })
        );

        // Grant S3 Vectors permissions to the index handler
        vectorIndexHandler.addToRolePolicy(
            new PolicyStatement({
                actions: [
                    "s3vectors:CreateIndex",
                    "s3vectors:DeleteIndex",
                    "s3vectors:GetIndex",
                    "s3vectors:ListIndexes",
                ],
                resources: ["*"],
            })
        );

        // Create Bedrock service role first (before the handler needs it)
        const bedrockServiceRole = new Role(this, "BedrockServiceRole", {
            assumedBy: new ServicePrincipal("bedrock.amazonaws.com"),
        });

        // Grant permissions to access S3 data source
        bedrockServiceRole.addToPolicy(
            new PolicyStatement({
                actions: ["s3:GetObject", "s3:ListBucket"],
                resources: [this.dataBucket.bucketArn, `${this.dataBucket.bucketArn}/*`],
            })
        );

        // Grant permissions to access this knowledge base's own S3 Vectors bucket and its indexes.
        // Scoped to the bucket resource (bucket-level actions like ListIndexes/GetVectorBucket)
        // and its index sub-resources (index-level actions like QueryVectors/GetVectors/PutVectors).
        bedrockServiceRole.addToPolicy(
            new PolicyStatement({
                actions: ["s3vectors:*"],
                resources: [
                    `arn:aws:s3vectors:${Stack.of(this).region}:${Stack.of(this).account}:bucket/${this.vectorBucketName}`,
                    `arn:aws:s3vectors:${Stack.of(this).region}:${Stack.of(this).account}:bucket/${this.vectorBucketName}/index/*`,
                ],
            })
        );

        // Grant permissions to invoke embedding model
        bedrockServiceRole.addToPolicy(
            new PolicyStatement({
                actions: ["bedrock:InvokeModel"],
                resources: [
                    `arn:aws:bedrock:${Stack.of(this).region}::foundation-model/${embeddingModel}`,
                ],
            })
        );

        // Grant Bedrock permissions to the knowledge base handler
        knowledgeBaseHandler.addToRolePolicy(
            new PolicyStatement({
                actions: [
                    "bedrock:CreateKnowledgeBase",
                    "bedrock:DeleteKnowledgeBase",
                    "bedrock:GetKnowledgeBase",
                    "bedrock:UpdateKnowledgeBase",
                    "bedrock:ListKnowledgeBases",
                ],
                resources: ["*"],
            })
        );

        // Grant IAM PassRole permission to the knowledge base handler
        knowledgeBaseHandler.addToRolePolicy(
            new PolicyStatement({
                actions: ["iam:PassRole"],
                resources: [bedrockServiceRole.roleArn],
                conditions: {
                    StringEquals: {
                        "iam:PassedToService": "bedrock.amazonaws.com",
                    },
                },
            })
        );

        // Grant CloudFormation permission to invoke the custom resource Lambdas
        vectorBucketHandler.grantInvoke(new ServicePrincipal("cloudformation.amazonaws.com"));
        vectorIndexHandler.grantInvoke(new ServicePrincipal("cloudformation.amazonaws.com"));
        knowledgeBaseHandler.grantInvoke(new ServicePrincipal("cloudformation.amazonaws.com"));

        // Create the S3 Vector bucket
        const vectorBucket = new CustomResource(this, "VectorBucket", {
            serviceToken: vectorBucketHandler.functionArn,
            properties: {
                vectorBucketName: this.vectorBucketName,
                encryptionConfiguration: {
                    sseType: "AES256",
                },
            },
        });

        // Create the S3 Vector index
        const vectorIndex = new CustomResource(this, "VectorIndex", {
            serviceToken: vectorIndexHandler.functionArn,
            properties: {
                vectorBucketName: this.vectorBucketName,
                indexName: this.vectorIndexName,
                dimension: vectorDimensions,
                dataType: "float32",
                distanceMetric: "euclidean",
                metadataConfiguration: {
                    nonFilterableMetadataKeys: ["AMAZON_BEDROCK_TEXT", "AMAZON_BEDROCK_METADATA"],
                },
            },
        });

        // Ensure index is created after bucket
        vectorIndex.node.addDependency(vectorBucket);

        // Create the knowledge base using custom resource
        const knowledgeBaseResource = new CustomResource(this, "KnowledgeBase", {
            serviceToken: knowledgeBaseHandler.functionArn,
            properties: {
                knowledgeBaseName: `${id}-knowledge-base`,
                description: "Knowledge base with S3 Vectors storage",
                roleArn: bedrockServiceRole.roleArn,
                vectorBucketArn: vectorBucket.getAttString("VectorBucketArn"),
                indexArn: vectorIndex.getAttString("IndexArn"),
                knowledgeBaseConfiguration: {
                    embeddingModelArn: `arn:aws:bedrock:${Stack.of(this).region}::foundation-model/${embeddingModel}`,
                    dimensions: vectorDimensions,
                    embeddingDataType: "FLOAT32",
                },
            },
        });

        // Create a reference to the knowledge base for other constructs
        this.knowledgeBase = {
            attrKnowledgeBaseId: knowledgeBaseResource.getAttString("KnowledgeBaseId"),
            attrKnowledgeBaseArn: knowledgeBaseResource.getAttString("KnowledgeBaseArn"),
        } as CfnKnowledgeBase;

        // Ensure knowledge base is created after vector resources
        knowledgeBaseResource.node.addDependency(vectorIndex);

        // Create data source using L1 construct (this still works with custom resource KB)
        this.dataSource = new CfnDataSource(this, "DataSource", {
            knowledgeBaseId: knowledgeBaseResource.getAttString("KnowledgeBaseId"),
            name: `${id}-data-source`,
            description: "Data source for knowledge base documents",
            dataDeletionPolicy: "RETAIN",
            dataSourceConfiguration: {
                type: "S3",
                s3Configuration: {
                    bucketArn: this.dataBucket.bucketArn,
                    inclusionPrefixes: ["kb/summaries/"],
                },
            },
        });

        // Ensure data source is created after knowledge base
        this.dataSource.node.addDependency(knowledgeBaseResource);

        // Deploy KB summary documents to data source bucket
        // Only summaries go into the KB; CSVs are for Athena/Glue only
        new BucketDeployment(this, "KnowledgeBaseAssets", {
            sources: [Source.asset(dataAssetPath)],
            destinationBucket: this.dataBucket,
            destinationKeyPrefix: "kb/summaries/",
        });

        // Add CDK-nag suppressions for the S3 bucket
        NagSuppressions.addResourceSuppressions(
            this.dataBucket,
            [
                {
                    id: "AwsSolutions-S1",
                    reason: "Server access logs not required for knowledge base data source bucket",
                },
                {
                    id: "AwsSolutions-S10",
                    reason: "SSL enforcement handled by knowledge base service role permissions",
                },
            ],
            true
        );

        // Create Lambda function for querying
        this.queryFunction = new PythonFunction(this, "KnowledgeBaseQueryFunction", {
            entry: "lib/stacks/backend/functions/kb-query",
            runtime: Runtime.PYTHON_3_12,
            timeout: Duration.minutes(5),
            environment: {
                KNOWLEDGE_BASE_ID: this.knowledgeBase.attrKnowledgeBaseId,
                BUCKET_NAME: this.dataBucket.bucketName,
                VECTOR_BUCKET_NAME: this.vectorBucketName,
                VECTOR_INDEX_NAME: this.vectorIndexName,
            },
        });

        // Grant permissions to query the knowledge base
        this.queryFunction.addToRolePolicy(
            new PolicyStatement({
                actions: ["bedrock:Retrieve", "bedrock:RetrieveAndGenerate"],
                resources: [this.knowledgeBase.attrKnowledgeBaseArn],
            })
        );

        // Grant basic S3 permissions to the query function
        this.queryFunction.addToRolePolicy(
            new PolicyStatement({
                actions: ["s3:GetObject", "s3:ListBucket"],
                resources: [this.dataBucket.bucketArn, `${this.dataBucket.bucketArn}/*`],
            })
        );

        // Grant S3 Vectors permissions for direct queries if needed
        this.queryFunction.addToRolePolicy(
            new PolicyStatement({
                actions: [
                    "s3vectors:QueryVectors",
                    "s3vectors:GetVectorBucket",
                    "s3vectors:GetIndex",
                ],
                resources: [
                    `arn:aws:s3vectors:${Stack.of(this).region}:${Stack.of(this).account}:bucket/*`,
                ],
            })
        );

        // Grant Bedrock permissions for direct model invocation
        this.queryFunction.addToRolePolicy(
            new PolicyStatement({
                actions: ["bedrock:InvokeModel"],
                resources: [
                    `arn:aws:bedrock:${Stack.of(this).region}::foundation-model/${embeddingModel}`,
                    `arn:aws:bedrock:${Stack.of(this).region}::foundation-model/${queryModelId}`,
                ],
            })
        );

        // Create sync function for S3 Vectors knowledge base
        const syncFunction = new PythonFunction(this, "KnowledgeBaseSyncFunction", {
            entry: "lib/stacks/backend/functions/kb-sync-s3vectors",
            runtime: Runtime.PYTHON_3_12,
            timeout: Duration.minutes(15),
            environment: {
                KNOWLEDGE_BASE_ID: this.knowledgeBase.attrKnowledgeBaseId,
                DATA_SOURCE_ID: this.dataSource.attrDataSourceId,
                VECTOR_BUCKET_NAME: this.vectorBucketName,
                VECTOR_INDEX_NAME: this.vectorIndexName,
                DATA_BUCKET_NAME: this.dataBucket.bucketName,
                REPORTS_TABLE_NAME: props.reportsTable?.tableName ?? "",
                METRICS_SUMMARY_TABLE_NAME: props.metricsSummaryTable?.tableName ?? "",
                LIVE_METRICS_TABLE_NAME: props.liveMetricsTable?.tableName ?? "",
            },
        });

        // Grant permissions to manage ingestion jobs
        syncFunction.addToRolePolicy(
            new PolicyStatement({
                actions: [
                    "bedrock:StartIngestionJob",
                    "bedrock:GetIngestionJob",
                    "bedrock:ListIngestionJobs",
                ],
                resources: [
                    this.knowledgeBase.attrKnowledgeBaseArn,
                    `${this.knowledgeBase.attrKnowledgeBaseArn}/data-source/*`,
                ],
            })
        );

        // Grant S3 write permission to upload the daily export CSV
        this.dataBucket.grantWrite(syncFunction);

        // Grant DynamoDB read permissions for the export step
        if (props.reportsTable) props.reportsTable.grantReadData(syncFunction);
        if (props.metricsSummaryTable) props.metricsSummaryTable.grantReadData(syncFunction);
        if (props.liveMetricsTable) props.liveMetricsTable.grantReadData(syncFunction);

        // Grant S3 Vectors permissions to sync function
        syncFunction.addToRolePolicy(
            new PolicyStatement({
                actions: [
                    "s3vectors:GetVectorBucket",
                    "s3vectors:ListIndexes",
                    "s3vectors:QueryVectors",
                    "s3vectors:GetIndex",
                ],
                resources: [
                    `arn:aws:s3vectors:${Stack.of(this).region}:${Stack.of(this).account}:bucket/*`,
                ],
            })
        );

        // Add CDK-nag suppressions
        NagSuppressions.addResourceSuppressions(
            [vectorBucketHandler, vectorIndexHandler, knowledgeBaseHandler],
            [
                {
                    id: "AwsSolutions-IAM5",
                    reason: "S3 Vectors and Bedrock operations require wildcard permissions for resource creation",
                },
            ],
            true
        );

        NagSuppressions.addResourceSuppressions(
            [this.queryFunction, syncFunction],
            [
                {
                    id: "AwsSolutions-IAM5",
                    reason: "Bedrock and S3 Vectors operations require wildcard permissions for knowledge base operations",
                },
            ],
            true
        );

        // EventBridge scheduled rule: rehydrate KB every 24 hours by triggering a new ingestion job
        new Rule(this, "KbRehydrationSchedule", {
            description:
                "Triggers KB data source sync daily to rehydrate embeddings with latest data",
            schedule: Schedule.rate(Duration.days(1)),
            targets: [new LambdaTarget(syncFunction)],
        });

        // Trigger initial ingestion on every deployment so embeddings are ready immediately
        const deployTrigger = new Trigger(this, "KbInitialSync", {
            handler: syncFunction,
            timeout: Duration.minutes(15),
        });
        deployTrigger.node.addDependency(this.dataSource);
    }
}
