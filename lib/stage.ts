// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Aspects, Stage, StageProps } from "aws-cdk-lib";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { Backend } from "./stacks/backend";
import { Frontend, FrontendDeployment } from "./stacks/frontend";

export class ApplicationStage extends Stage {
    constructor(scope: Construct, id: string, props?: StageProps) {
        super(scope, id, props);

        const frontend = new Frontend(this, "frontend");

        const backend = new Backend(this, "backend", {
            urls: frontend.urls,
        });

        // this stack must be named frontendDeployment
        new FrontendDeployment(this, "frontendDeployment", {
            websiteBucket: frontend.websiteBucket,
            distribution: frontend.distribution,
            environmentVariables: backend.environmentVariables,
        });

        NagSuppressions.addResourceSuppressions(
            this,
            [
                {
                    id: "AwsSolutions-IAM4",
                    reason: "Managed policies are acceptable.",
                },
                {
                    id: "AwsSolutions-IAM5",
                    reason: "High-level constructs require wildcards for dynamic resource creation and management.",
                },
                {
                    id: "AwsSolutions-L1",
                    reason: "High-level constructs set their own runtimes.",
                },
            ],
            true
        );
        Aspects.of(this).add(new AwsSolutionsChecks());
    }
}
