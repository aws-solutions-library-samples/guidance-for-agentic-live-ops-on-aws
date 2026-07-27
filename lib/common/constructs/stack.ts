// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Stack as StackConstruct, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";

export class Stack extends StackConstruct {
    constructor(scope: Construct, id: string, props?: StackProps) {
        const prefix = scope.node.tryGetContext("projectId");
        const prefixedId = prefix ? `${prefix}-${id}` : id;
        super(scope, prefixedId, {
            ...props,
            description: "Guidance for Agentic Live Ops on AWS (SO9699)",
        });
    }
}
