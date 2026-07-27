// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Stack } from "aws-cdk-lib";
import {
    FlowLogTrafficType,
    GatewayVpcEndpointAwsService,
    InterfaceVpcEndpointAwsService,
    IpAddresses,
    SecurityGroup,
    SubnetType,
    Vpc,
} from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

export class Networking extends Construct {
    public readonly vpc: Vpc;
    public readonly runtimeSecurityGroup: SecurityGroup;
    public readonly databaseSecurityGroup: SecurityGroup;

    constructor(scope: Construct, id: string) {
        super(scope, id);

        const subnetPrefix = Stack.of(this).stackName;

        const vpc = new Vpc(this, "vpc", {
            ipAddresses: IpAddresses.cidr("10.0.0.0/16"),
            natGateways: 0,
            maxAzs: 2,
            enableDnsHostnames: true,
            enableDnsSupport: true,
            subnetConfiguration: [
                {
                    name: `${subnetPrefix}-privateIsolated`,
                    subnetType: SubnetType.PRIVATE_ISOLATED,
                    cidrMask: 24,
                },
            ],
            flowLogs: {
                flowLog: {
                    trafficType: FlowLogTrafficType.REJECT,
                },
            },
            gatewayEndpoints: {
                DynamoDB: {
                    service: GatewayVpcEndpointAwsService.DYNAMODB,
                },
                S3: {
                    service: GatewayVpcEndpointAwsService.S3,
                },
            },
        });

        const runtimeSecurityGroup = new SecurityGroup(this, "runtimeSecurityGroup", {
            vpc,
            description: "Security group for Lambda functions",
            allowAllOutbound: true,
        });

        const databaseSecurityGroup = new SecurityGroup(this, "databaseSecurityGroup", {
            vpc,
            description: "Security group for Aurora database",
            allowAllOutbound: false,
        });

        vpc.addInterfaceEndpoint("logsEndpoint", {
            service: InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
            subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
        });
        vpc.addInterfaceEndpoint("bedrockEndpoint", {
            service: InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
            subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
        });
        vpc.addInterfaceEndpoint("ecrDockerEndpoint", {
            service: InterfaceVpcEndpointAwsService.ECR_DOCKER,
            subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
        });
        vpc.addInterfaceEndpoint("ecrApiEndpoint", {
            service: InterfaceVpcEndpointAwsService.ECR,
            subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
        });
        vpc.addInterfaceEndpoint("bedrockAgentCoreEndpoint", {
            service: new InterfaceVpcEndpointAwsService("bedrock-agentcore"),
            subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
        });
        vpc.addInterfaceEndpoint("bedrockAgentEndpoint", {
            service: new InterfaceVpcEndpointAwsService("bedrock-agent"),
            subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
        });
        vpc.addInterfaceEndpoint("bedrockAgentRuntimeEndpoint", {
            service: new InterfaceVpcEndpointAwsService("bedrock-agent-runtime"),
            subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
        });
        vpc.addInterfaceEndpoint("athenaEndpoint", {
            service: InterfaceVpcEndpointAwsService.ATHENA,
            subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
        });
        vpc.addInterfaceEndpoint("ssmEndpoint", {
            service: InterfaceVpcEndpointAwsService.SSM,
            subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
        });
        vpc.addInterfaceEndpoint("bedrockAgentCoreControlEndpoint", {
            service: new InterfaceVpcEndpointAwsService("bedrock-agentcore-control"),
            subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
        });

        this.vpc = vpc;
        this.runtimeSecurityGroup = runtimeSecurityGroup;
        this.databaseSecurityGroup = databaseSecurityGroup;
    }
}
