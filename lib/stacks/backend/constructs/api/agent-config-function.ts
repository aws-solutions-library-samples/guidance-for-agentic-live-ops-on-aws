// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Duration } from "aws-cdk-lib";
import { TableV2 } from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { FunctionUrl, HttpMethod, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import { join } from "path";

export interface AgentConfigFunctionProps {
    agentConfigTable: TableV2;
    urls: string[];
}

export class AgentConfigFunction extends Construct {
    public readonly configFunctionUrl: FunctionUrl;

    constructor(scope: Construct, id: string, props: AgentConfigFunctionProps) {
        super(scope, id);

        const { agentConfigTable, urls } = props;

        const agentConfigFunction = new NodejsFunction(this, "agentConfigFunction", {
            entry: join(__dirname, "agent-config-function.handler.ts"),
            runtime: Runtime.NODEJS_22_X,
            timeout: Duration.seconds(10),
            memorySize: 256,
            environment: {
                AGENT_CONFIG_TABLE_NAME: agentConfigTable.tableName,
                ALLOWED_ORIGINS: JSON.stringify(urls),
            },
            bundling: {
                externalModules: ["@aws-sdk/*"],
            },
        });

        agentConfigTable.grantReadWriteData(agentConfigFunction);

        const configUrl = agentConfigFunction.addFunctionUrl({
            authType: lambda.FunctionUrlAuthType.AWS_IAM,
            cors: {
                allowedOrigins: urls,
                allowedMethods: [
                    HttpMethod.GET,
                    HttpMethod.POST,
                    HttpMethod.PUT,
                    HttpMethod.DELETE,
                ],
                allowedHeaders: [
                    "Content-Type",
                    "Authorization",
                    "X-Amz-Date",
                    "X-Amz-Security-Token",
                    "X-Amz-User-Agent",
                    "X-Amz-Content-Sha256",
                ],
                allowCredentials: true,
                maxAge: Duration.minutes(5),
            },
        });

        this.configFunctionUrl = configUrl;
    }
}
