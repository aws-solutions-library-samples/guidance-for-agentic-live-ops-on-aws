// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Duration, Names } from "aws-cdk-lib";
import {
    AccountRecovery,
    ClientAttributes,
    FeaturePlan,
    UserPool,
    UserPoolClient,
    UserPoolDomain,
    UserPoolGroup,
} from "aws-cdk-lib/aws-cognito";
import { IdentityPool, UserPoolAuthenticationProvider } from "aws-cdk-lib/aws-cognito-identitypool";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Function } from "aws-cdk-lib/aws-lambda";
import { CfnWebACL, CfnWebACLAssociation } from "aws-cdk-lib/aws-wafv2";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { createManagedRules } from "../../../common/utilities";

interface AuthProps {
    urls: string[];
    hydrationFunction?: Function;
}

export class Auth extends Construct {
    public readonly userPool: UserPool;
    public readonly userPoolDomain?: UserPoolDomain;
    public readonly userPoolClient: UserPoolClient;
    public readonly identityPool: IdentityPool;
    public readonly regionalWebAclArn: string;

    constructor(scope: Construct, id: string, props: AuthProps) {
        super(scope, id);

        const { urls, hydrationFunction } = props;

        const userPool = new UserPool(this, "userPool", {
            selfSignUpEnabled: false,
            signInAliases: {
                email: true,
            },
            autoVerify: {
                email: true,
            },
            standardAttributes: {
                email: {
                    required: true,
                    mutable: true,
                },
            },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireDigits: true,
                requireUppercase: true,
                requireSymbols: true,
            },
            accountRecovery: AccountRecovery.EMAIL_ONLY,
            featurePlan: FeaturePlan.ESSENTIALS,
            lambdaTriggers: {
                postConfirmation: hydrationFunction,
            },
        });
        NagSuppressions.addResourceSuppressions(userPool, [
            {
                id: "AwsSolutions-COG2",
                reason: "Cognito user pool should not require MFA for demos.",
            },
            {
                id: "AwsSolutions-COG3",
                reason: "AdvancedSecurityMode is set to depreciate. Using Cognito feature plan's essential security feature.",
            },
            {
                id: "AwsSolutions-COG8",
                reason: "This guidance uses the Cognito Essentials feature plan to keep demo costs low. Production deployments should upgrade to FeaturePlan.PLUS and enable threat protection.",
            },
        ]);

        new UserPoolGroup(this, "adminUserPoolGroup", {
            userPool,
            groupName: "Admin",
        });

        new UserPoolGroup(this, "usersUserPoolGroup", {
            userPool,
            groupName: "Users",
        });

        const tokenValidity = Duration.hours(8);
        const userPoolClient = new UserPoolClient(this, "userPoolClient", {
            userPool,
            generateSecret: false,
            refreshTokenValidity: tokenValidity,
            accessTokenValidity: tokenValidity,
            idTokenValidity: tokenValidity,
            readAttributes: new ClientAttributes().withStandardAttributes({
                email: true,
            }),
            authFlows: {
                adminUserPassword: true,
                custom: true,
                userSrp: true,
            },
            oAuth: {
                callbackUrls: urls,
                logoutUrls: urls,
            },
        });

        const identityPool = new IdentityPool(this, "identityPool", {
            allowUnauthenticatedIdentities: false,
            authenticationProviders: {
                userPools: [
                    new UserPoolAuthenticationProvider({
                        userPool,
                        userPoolClient,
                    }),
                ],
            },
        });
        identityPool.unauthenticatedRole.addToPrincipalPolicy(
            new PolicyStatement({
                effect: Effect.DENY,
                actions: ["*"],
                resources: ["*"],
            })
        );

        const regionalWebAcl = new CfnWebACL(this, "regionalWebAcl", {
            defaultAction: { allow: {} },
            scope: "REGIONAL",
            visibilityConfig: {
                metricName: "regionalWebAcl",
                sampledRequestsEnabled: true,
                cloudWatchMetricsEnabled: true,
            },
            rules: [
                {
                    name: "ipRateLimitingRule",
                    priority: 0,
                    statement: {
                        rateBasedStatement: {
                            limit: 3000,
                            aggregateKeyType: "IP",
                        },
                    },
                    action: {
                        block: {},
                    },
                    visibilityConfig: {
                        sampledRequestsEnabled: true,
                        cloudWatchMetricsEnabled: true,
                        metricName: "ipRateLimitingRule",
                    },
                },
                ...createManagedRules("regional", 1, [
                    {
                        name: "AWSManagedRulesCommonRuleSet",
                        overrideAction: {
                            count: {},
                        },
                    },
                    {
                        name: "AWSManagedRulesBotControlRuleSet",
                        overrideAction: {
                            count: {},
                        },
                    },
                    {
                        name: "AWSManagedRulesKnownBadInputsRuleSet",
                    },
                    {
                        name: "AWSManagedRulesUnixRuleSet",
                        ruleActionOverrides: [
                            {
                                name: "UNIXShellCommandsVariables_BODY",
                                actionToUse: {
                                    count: {},
                                },
                            },
                        ],
                    },
                    {
                        name: "AWSManagedRulesSQLiRuleSet",
                        ruleActionOverrides: [
                            {
                                name: "SQLi_BODY",
                                actionToUse: {
                                    count: {},
                                },
                            },
                        ],
                    },
                ]),
            ],
        });
        const regionalWebAclArn = regionalWebAcl.attrArn;

        new CfnWebACLAssociation(this, "userPoolWebAclAssociation", {
            resourceArn: userPool.userPoolArn,
            webAclArn: regionalWebAclArn,
        });

        this.userPool = userPool;
        this.userPoolDomain = userPool.addDomain("userPoolDomain", {
            cognitoDomain: {
                domainPrefix: Names.uniqueResourceName(this, { maxLength: 63 }).toLowerCase(),
            },
        });
        this.userPoolClient = userPoolClient;
        this.identityPool = identityPool;
        this.regionalWebAclArn = regionalWebAclArn;
    }
}
