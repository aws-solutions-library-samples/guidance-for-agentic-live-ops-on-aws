// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Duration, Names, Size, Stack } from "aws-cdk-lib";
import { TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Stream, StreamMode } from "aws-cdk-lib/aws-kinesis";
import * as firehose from "aws-cdk-lib/aws-kinesisfirehose";
import { StartingPosition } from "aws-cdk-lib/aws-lambda";
import { KinesisEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { PythonFunction } from "@aws-cdk/aws-lambda-python-alpha";
import { Runtime, Architecture } from "aws-cdk-lib/aws-lambda";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { join } from "path";

export interface RealtimeMonitorProps {
    liveMetricsTable: TableV2;
    reportsTable: TableV2;
    patternRulesTable: TableV2;
    metricsSummaryTable: TableV2;
    knowledgeBaseId: string;
    remediationsKnowledgeBaseId: string;
    athenaDatabase: string;
    athenaWorkgroup: string;
    athenaResultsBucket: string;
    athenaDataBucketArn: string;
    /** S3 bucket name where Athena CSV data lives (for daily export) */
    dataBucketName: string;
    /** Bedrock model ID for the analysis runner, resolved from cdk.json modelConfig */
    modelId: string;
}

export class RealtimeMonitor extends Construct {
    public readonly gameEventStream: Stream;
    public readonly analysisRunnerFunction: PythonFunction;

    constructor(scope: Construct, id: string, props: RealtimeMonitorProps) {
        super(scope, id);

        const {
            liveMetricsTable,
            reportsTable,
            patternRulesTable,
            metricsSummaryTable,
            knowledgeBaseId,
            remediationsKnowledgeBaseId,
            athenaDatabase,
            athenaWorkgroup,
            athenaResultsBucket,
            athenaDataBucketArn,
            dataBucketName,
            modelId,
        } = props;

        // Kinesis stream for real-time game event ingestion
        this.gameEventStream = new Stream(this, "gameEventStream", {
            streamName: `${Names.uniqueResourceName(this, { maxLength: 40 })}-game-events`,
            streamMode: StreamMode.ON_DEMAND,
        });

        const runtimeDir = join(__dirname, "runtime");

        // Lambda: Pattern Detector — processes Kinesis batches, updates sliding window counters
        const patternDetector = new PythonFunction(this, "patternDetector", {
            entry: runtimeDir,
            index: "pattern_detector.py",
            handler: "handler",
            runtime: Runtime.PYTHON_3_13,
            architecture: Architecture.ARM_64,
            timeout: Duration.minutes(1),
            memorySize: 256,
            environment: {
                LIVE_METRICS_TABLE: liveMetricsTable.tableName,
                PATTERN_RULES_TABLE: patternRulesTable.tableName,
                METRICS_SUMMARY_TABLE: metricsSummaryTable.tableName,
                ANALYSIS_RUNNER_FUNCTION: "", // Set below after analysis runner is created
            },
        });

        // Lambda: Analysis Runner — invoked when a pattern fires, runs Strands agent
        const analysisRunner = new PythonFunction(this, "analysisRunner", {
            entry: runtimeDir,
            index: "analysis_runner.py",
            handler: "handler",
            runtime: Runtime.PYTHON_3_13,
            architecture: Architecture.ARM_64,
            timeout: Duration.minutes(5),
            memorySize: 1024,
            environment: {
                LIVE_METRICS_TABLE: liveMetricsTable.tableName,
                REPORTS_TABLE: reportsTable.tableName,
                BEDROCK_KB_ID: knowledgeBaseId,
                REMEDIATIONS_KB_ID: remediationsKnowledgeBaseId,
                BEDROCK_MODEL_ID: modelId,
                BEDROCK_REGION: Stack.of(this).region,
                ATHENA_DATABASE: athenaDatabase,
                ATHENA_WORKGROUP: athenaWorkgroup,
                ATHENA_RESULTS_BUCKET: athenaResultsBucket,
            },
        });

        // Update pattern detector with analysis runner function name
        patternDetector.addEnvironment("ANALYSIS_RUNNER_FUNCTION", analysisRunner.functionName);

        // Wire Kinesis → Pattern Detector
        patternDetector.addEventSource(
            new KinesisEventSource(this.gameEventStream, {
                startingPosition: StartingPosition.LATEST,
                batchSize: 100,
                maxBatchingWindow: Duration.seconds(5),
            })
        );

        // Permissions: Pattern Detector
        liveMetricsTable.grantReadWriteData(patternDetector);
        patternRulesTable.grantReadData(patternDetector);
        metricsSummaryTable.grantReadWriteData(patternDetector);
        analysisRunner.grantInvoke(patternDetector);

        // Permissions: Analysis Runner
        liveMetricsTable.grantReadData(analysisRunner);
        reportsTable.grantReadWriteData(analysisRunner);

        analysisRunner.addToRolePolicy(
            new PolicyStatement({
                sid: "BedrockModelInvocation",
                effect: Effect.ALLOW,
                actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
                resources: ["*"],
            })
        );
        analysisRunner.addToRolePolicy(
            new PolicyStatement({
                sid: "BedrockKBAccess",
                effect: Effect.ALLOW,
                actions: ["bedrock:Retrieve", "bedrock:RetrieveAndGenerate"],
                resources: [
                    `arn:aws:bedrock:${Stack.of(this).region}:${Stack.of(this).account}:knowledge-base/*`,
                ],
            })
        );

        // Athena + Glue + S3 permissions for historical data queries
        analysisRunner.addToRolePolicy(
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
        analysisRunner.addToRolePolicy(
            new PolicyStatement({
                sid: "GlueCatalogAccess",
                effect: Effect.ALLOW,
                actions: [
                    "glue:GetTable",
                    "glue:GetTables",
                    "glue:GetDatabase",
                    "glue:GetDatabases",
                    "glue:GetPartitions",
                ],
                resources: [
                    `arn:aws:glue:${Stack.of(this).region}:${Stack.of(this).account}:catalog`,
                    `arn:aws:glue:${Stack.of(this).region}:${Stack.of(this).account}:database/*`,
                    `arn:aws:glue:${Stack.of(this).region}:${Stack.of(this).account}:table/*/*`,
                ],
            })
        );
        analysisRunner.addToRolePolicy(
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
        analysisRunner.addToRolePolicy(
            new PolicyStatement({
                sid: "AthenaS3DataAccess",
                effect: Effect.ALLOW,
                actions: ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"],
                resources: [athenaDataBucketArn, `${athenaDataBucketArn}/*`],
            })
        );

        this.analysisRunnerFunction = analysisRunner;

        // ── Firehose: Raw game events → S3 for Athena archival ──────────
        // Reads from the same Kinesis stream in parallel with the pattern
        // detector. Firehose buffers, batches, and writes JSON-line files
        // to s3://{dataBucket}/athena/game_events/ for Athena querying.
        const dataBucket = Bucket.fromBucketName(this, "dataBucket", dataBucketName);

        const firehoseStream = new firehose.DeliveryStream(this, "eventArchiveStream", {
            source: new firehose.KinesisStreamSource(this.gameEventStream),
            destination: new firehose.S3Bucket(dataBucket, {
                dataOutputPrefix: "athena/game_events/",
                errorOutputPrefix: "athena/game_events_errors/",
                bufferingInterval: Duration.minutes(5),
                bufferingSize: Size.mebibytes(5),
                processors: [new firehose.AppendDelimiterToRecordProcessor()],
            }),
        });

        NagSuppressions.addResourceSuppressions(
            firehoseStream,
            [
                {
                    id: "AwsSolutions-KDF1",
                    reason: "Firehose SSE is not supported when source is a Kinesis stream. The source Kinesis stream is encrypted at rest.",
                },
            ],
            true
        );
    }
}
