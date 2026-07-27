// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { CfnWebACL } from "aws-cdk-lib/aws-wafv2";

/**
 * Single fallback Bedrock model ID used only when `context.modelConfig.defaultModelId`
 * is absent from cdk.json. cdk.json is the source of truth; this constant exists so the
 * fallback lives in exactly one place rather than being duplicated across constructs.
 */
export const DEFAULT_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";

export function createManagedRules(
    prefix: string,
    startingPriority: number,
    rules: {
        name: string;
        overrideAction?: CfnWebACL.OverrideActionProperty;
        ruleActionOverrides?: CfnWebACL.RuleActionOverrideProperty[];
    }[]
): CfnWebACL.RuleProperty[] {
    return rules.map((rule, index) => {
        const ruleName = `${prefix}-${rule.name}`;
        return {
            name: ruleName,
            priority: startingPriority + index,
            overrideAction: rule.overrideAction || {
                none: {},
            },
            statement: {
                managedRuleGroupStatement: {
                    vendorName: "AWS",
                    name: rule.name,
                    ruleActionOverrides: rule.ruleActionOverrides,
                },
            },
            visibilityConfig: {
                metricName: ruleName,
                sampledRequestsEnabled: true,
                cloudWatchMetricsEnabled: true,
            },
        };
    });
}
