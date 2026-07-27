// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { CloudfrontWebAcl } from "@aws/pdk/static-website";
import { CfnOutput, PropertyInjectors, StackProps } from "aws-cdk-lib";
import {
    AllowedMethods,
    Distribution,
    OriginRequestPolicy,
    SecurityPolicyProtocol,
    SSLMethod,
    ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { NodejsBuild } from "deploy-time-build";
import { join } from "path";
import { FunctionPlatformInjector } from "../../common/blueprints";
import { LoggingBucket } from "../../common/constructs/s3";
import { Stack } from "../../common/constructs/stack";

export class Frontend extends Stack {
    public readonly websiteBucket: Bucket;
    public readonly distribution: Distribution;
    public readonly urls: string[];

    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        const loggingBucket = new LoggingBucket(this, "loggingBucket");

        const websiteBucket = new Bucket(this, "websiteBucket", {
            serverAccessLogsBucket: loggingBucket,
        });

        const cloudfrontWebAcl = new CloudfrontWebAcl(this, "Acl", {
            managedRules: [
                {
                    vendor: "AWS",
                    name: "AWSManagedRulesCommonRuleSet",
                },
                {
                    vendor: "AWS",
                    name: "AWSManagedRulesAmazonIpReputationList",
                },
                {
                    vendor: "AWS",
                    name: "AWSManagedRulesBotControlRuleSet",
                },
            ],
        });
        PropertyInjectors.of(cloudfrontWebAcl).add(new FunctionPlatformInjector());

        const distribution = new Distribution(this, "distribution", {
            defaultRootObject: "index.html",
            defaultBehavior: {
                origin: S3BucketOrigin.withOriginAccessControl(websiteBucket),
                viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: AllowedMethods.ALLOW_ALL,
                originRequestPolicy: OriginRequestPolicy.CORS_S3_ORIGIN,
            },
            errorResponses: [
                {
                    httpStatus: 404,
                    responsePagePath: "/index.html",
                    responseHttpStatus: 200,
                },
                {
                    httpStatus: 403,
                    responsePagePath: "/index.html",
                    responseHttpStatus: 200,
                },
            ],
            minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
            sslSupportMethod: SSLMethod.SNI,
            webAclId: cloudfrontWebAcl.webAclArn,
            logBucket: loggingBucket,
            logIncludesCookies: true,
            logFilePrefix: "distribution",
        });
        NagSuppressions.addResourceSuppressions(distribution, [
            {
                id: "AwsSolutions-CFR1",
                reason: "Distribution should be globally accessible.",
            },
            {
                id: "AwsSolutions-CFR4",
                reason: "Distribution is configured with TLS_V1_2_2021.",
            },
        ]);

        new CfnOutput(this, "url", {
            value: distribution.distributionDomainName,
            description: "CloudFront URL",
        });

        this.websiteBucket = websiteBucket;
        this.distribution = distribution;
        this.urls = [`https://${distribution.distributionDomainName}`, "http://localhost:3000"];
    }
}

interface FrontendDeploymentProps extends StackProps {
    websiteBucket: Bucket;
    distribution: Distribution;
    environmentVariables: Record<string, string>;
}

export class FrontendDeployment extends Stack {
    constructor(scope: Construct, id: string, props: FrontendDeploymentProps) {
        super(scope, id, props);

        const { websiteBucket, distribution, environmentVariables } = props;

        const staticWebsiteBuild = new NodejsBuild(this, "staticWebsiteBuild", {
            assets: [
                {
                    path: join(__dirname, "app"),
                    exclude: ["dist", "node_modules"],
                },
            ],
            destinationBucket: websiteBucket,
            outputSourceDirectory: "dist",
            buildCommands: ["npm install --legacy-peer-deps", "npm run build"],
            buildEnvironment: environmentVariables,
            distribution,
            excludeCommonFiles: true,
            nodejsVersion: 22,
        });
        NagSuppressions.addResourceSuppressions(
            staticWebsiteBuild,
            [
                {
                    id: "AwsSolutions-CB4",
                    reason: "CodeBuild project does not need a KMS key for encryption.",
                },
            ],
            true
        );

        new CfnOutput(this, "environmentVariables", {
            value: JSON.stringify(environmentVariables),
        });
    }
}
