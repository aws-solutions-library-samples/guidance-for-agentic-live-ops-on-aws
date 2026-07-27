// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { RemovalPolicy } from "aws-cdk-lib";
import { Bucket, BucketEncryption, BlockPublicAccess } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";

export class SchemaIngest extends Construct {
    public readonly rawBucket: Bucket;
    public readonly docsBucket: Bucket;

    constructor(scope: Construct, id: string) {
        super(scope, id);

        // S3 bucket for raw schema file uploads — EventBridge notifications enabled
        // so S3 Object Created events are emitted for the SchemaPipeline to consume
        this.rawBucket = new Bucket(this, "RawSchemasBucket", {
            encryption: BucketEncryption.S3_MANAGED,
            versioned: true,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            eventBridgeEnabled: true,
        });

        // S3 bucket for generated/reviewed markdown docs
        this.docsBucket = new Bucket(this, "SchemaDocsBucket", {
            encryption: BucketEncryption.S3_MANAGED,
            versioned: true,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        // cdk-nag suppressions consistent with existing KnowledgeBase construct
        NagSuppressions.addResourceSuppressions(
            [this.rawBucket, this.docsBucket],
            [
                {
                    id: "AwsSolutions-S1",
                    reason: "Server access logs not required for schema discovery pipeline buckets",
                },
                {
                    id: "AwsSolutions-S10",
                    reason: "SSL enforcement handled by service role permissions and bucket policies",
                },
            ],
            true
        );
    }
}
