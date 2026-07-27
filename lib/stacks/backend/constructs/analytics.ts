// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { CfnDatabase, CfnTable } from "aws-cdk-lib/aws-glue";
import { CfnWorkGroup } from "aws-cdk-lib/aws-athena";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";

/** Column definition for a Glue table */
export interface ColumnDef {
    name: string;
    type: string;
}

/** Table schema definition for Glue catalog */
export interface TableDef {
    name: string;
    s3Prefix: string;
    columns: ColumnDef[];
    /** Data format: "csv" (default) or "json" */
    format?: "csv" | "json";
}

export interface AnalyticsProps {
    /** S3 bucket containing the data files */
    dataBucket: Bucket;
    /** Table definitions — driven from cdk.json context */
    tables: TableDef[];
    /** Optional override for the Glue database / Athena workgroup name (default: "liveops") */
    databaseName?: string;
}

export class Analytics extends Construct {
    public readonly databaseName: string;
    public readonly workgroupName: string;
    public readonly resultsBucketName: string;
    public readonly dataBucketArn: string;

    constructor(scope: Construct, id: string, props: AnalyticsProps) {
        super(scope, id);

        const { dataBucket, tables, databaseName = "liveops" } = props;
        const accountId = Stack.of(this).account;

        // Athena query results bucket
        const resultsBucket = new Bucket(this, "AthenaResults", {
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            lifecycleRules: [{ expiration: Duration.days(7) }],
        });
        this.resultsBucketName = resultsBucket.bucketName;
        this.dataBucketArn = dataBucket.bucketArn;

        NagSuppressions.addResourceSuppressions(
            resultsBucket,
            [
                {
                    id: "AwsSolutions-S1",
                    reason: "Athena query results are ephemeral with 7-day TTL, access logs not required",
                },
            ],
            true
        );

        // Glue database
        this.databaseName = databaseName;
        const glueDatabase = new CfnDatabase(this, "GlueDatabase", {
            catalogId: accountId,
            databaseInput: {
                name: this.databaseName,
                description: "Analytics data catalog",
            },
        });

        // Create Glue tables from config-driven definitions
        for (const table of tables) {
            const isJson = table.format === "json";
            const glueTable = new CfnTable(this, `Table_${table.name}`, {
                catalogId: accountId,
                databaseName: this.databaseName,
                tableInput: {
                    name: table.name,
                    tableType: "EXTERNAL_TABLE",
                    parameters: isJson
                        ? { classification: "json" }
                        : {
                              "skip.header.line.count": "1",
                              classification: "csv",
                              delimiter: ",",
                          },
                    storageDescriptor: {
                        location: `s3://${dataBucket.bucketName}/athena/${table.name}/`,
                        inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
                        outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                        serdeInfo: isJson
                            ? {
                                  serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
                                  parameters: {
                                      "ignore.malformed.json": "TRUE",
                                  },
                              }
                            : {
                                  serializationLibrary:
                                      "org.apache.hadoop.hive.serde2.OpenCSVSerde",
                                  parameters: {
                                      separatorChar: ",",
                                      quoteChar: '"',
                                      escapeChar: "\\",
                                  },
                              },
                        columns: table.columns.map((c) => ({ name: c.name, type: c.type })),
                    },
                },
            });
            glueTable.addDependency(glueDatabase);
        }

        // Athena workgroup
        this.workgroupName = databaseName;

        new CfnWorkGroup(this, "AthenaWorkgroup", {
            name: this.workgroupName,
            recursiveDeleteOption: true,
            workGroupConfiguration: {
                resultConfiguration: {
                    outputLocation: `s3://${resultsBucket.bucketName}/query-results/`,
                },
                enforceWorkGroupConfiguration: true,
                publishCloudWatchMetricsEnabled: true,
                bytesScannedCutoffPerQuery: 100_000_000,
                engineVersion: { selectedEngineVersion: "Athena engine version 3" },
            },
        });
    }
}
