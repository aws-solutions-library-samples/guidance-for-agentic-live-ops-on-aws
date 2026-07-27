// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { RemovalPolicy, Stack } from "aws-cdk-lib";
import { ISecurityGroup, IVpc, Port, SubnetType } from "aws-cdk-lib/aws-ec2";
import { CfnDBCluster, CfnDBInstance, CfnDBSubnetGroup } from "aws-cdk-lib/aws-neptune";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

export interface NeptuneServerlessProps {
    vpc: IVpc;
    databaseSecurityGroup: ISecurityGroup;
    runtimeSecurityGroup: ISecurityGroup;
}

export class NeptuneServerless extends Construct {
    public readonly clusterEndpoint: string;
    public readonly clusterPort: number;
    public readonly clusterArn: string;

    constructor(scope: Construct, id: string, props: NeptuneServerlessProps) {
        super(scope, id);

        const { vpc, databaseSecurityGroup, runtimeSecurityGroup } = props;

        // Allow AgentCore runtime to access Neptune on port 8182
        databaseSecurityGroup.addIngressRule(
            runtimeSecurityGroup,
            Port.tcp(8182),
            "Allow AgentCore runtime to access Neptune"
        );

        // Subnet group using VPC private isolated subnets
        const subnetGroup = new CfnDBSubnetGroup(this, "SubnetGroup", {
            dbSubnetGroupDescription: "Neptune Serverless subnet group",
            subnetIds: vpc.selectSubnets({
                subnetType: SubnetType.PRIVATE_ISOLATED,
            }).subnetIds,
        });

        // Neptune Serverless cluster (L1 — L2 alpha doesn't support Serverless)
        const cluster = new CfnDBCluster(this, "Cluster", {
            engineVersion: "1.3.4.0",
            dbSubnetGroupName: subnetGroup.ref,
            vpcSecurityGroupIds: [databaseSecurityGroup.securityGroupId],
            serverlessScalingConfiguration: {
                minCapacity: 1,
                maxCapacity: 8,
            },
            storageEncrypted: true,
            iamAuthEnabled: true,
            deletionProtection: false,
            backupRetentionPeriod: 7,
        });
        cluster.applyRemovalPolicy(RemovalPolicy.DESTROY);
        cluster.addDependency(subnetGroup);

        // Primary instance — db.serverless class for Neptune Serverless
        const instance = new CfnDBInstance(this, "Instance", {
            dbInstanceClass: "db.serverless",
            dbClusterIdentifier: cluster.ref,
            autoMinorVersionUpgrade: true,
        });
        instance.applyRemovalPolicy(RemovalPolicy.DESTROY);
        instance.addDependency(cluster);

        const region = Stack.of(this).region;
        const accountId = Stack.of(this).account;

        this.clusterEndpoint = cluster.attrEndpoint;
        this.clusterPort = 8182;
        this.clusterArn = `arn:aws:neptune-db:${region}:${accountId}:${cluster.attrClusterResourceId}/*`;

        // Store endpoint in SSM so other constructs can reference it without a CDK token
        // This breaks the circular dependency that causes CloudFormation early validation failures
        new StringParameter(this, "EndpointParam", {
            parameterName: "/liveops/neptune/endpoint",
            stringValue: cluster.attrEndpoint,
            description: "Neptune cluster endpoint for AgentCore runtime",
        });
    }
}
