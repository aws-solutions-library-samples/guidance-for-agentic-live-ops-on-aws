// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Bucket, BucketProps, HttpMethods, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export class LoggingBucket extends Bucket {
    constructor(scope: Construct, id: string, props?: Omit<BucketProps, "serverAccessLogsBucket">) {
        super(scope, id, {
            serverAccessLogsPrefix: `${id}/`,
            objectOwnership: ObjectOwnership.BUCKET_OWNER_PREFERRED,
            ...props,
        });
    }
}

interface WebBucketProps extends Omit<BucketProps, "cors"> {
    allowedOrigins: string[];
}

export class WebBucket extends Bucket {
    constructor(scope: Construct, id: string, props: WebBucketProps) {
        super(scope, id, {
            cors: [
                {
                    allowedMethods: [
                        HttpMethods.GET,
                        HttpMethods.HEAD,
                        HttpMethods.POST,
                        HttpMethods.PUT,
                        HttpMethods.DELETE,
                    ],
                    allowedOrigins: props.allowedOrigins,
                    allowedHeaders: ["*"],
                    exposedHeaders: [
                        "x-amz-server-side-encryption",
                        "x-amz-request-id",
                        "x-amz-id-2",
                        "ETag",
                        "x-amz-meta-foo",
                    ],
                    maxAge: 3000,
                },
            ],
            ...props,
        });
    }
}
