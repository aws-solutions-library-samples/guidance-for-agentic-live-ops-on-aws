// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Memory as AgentCoreMemory } from "@aws-cdk/aws-bedrock-agentcore-alpha";
import { Duration, Names } from "aws-cdk-lib";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface MemoryProps {
    /**
     * Name for the memory resource
     * Valid characters are a-z, A-Z, 0-9, _ (underscore)
     * Must start with a letter and can be up to 48 characters long
     */
    readonly memoryName?: string;

    /**
     * Description for the memory resource
     * @default - "Short-term memory for liveops"
     */
    readonly description?: string;

    /**
     * Number of days to retain events
     * @default - 7 days
     */
    readonly expirationDuration?: Duration;
}

/**
 * Creates an AgentCore Memory resource for short-term conversation storage.
 *
 * This construct uses the official AgentCore Memory L2 construct from
 * @aws-cdk/aws-bedrock-agentcore-alpha to create a memory space that can be
 * used by AgentCore agents to store and retrieve conversation history.
 *
 * Each user gets their own session within the shared memory space, isolated by actor_id.
 *
 * Memory operates on two levels:
 * - Short-Term Memory (STM): Immediate conversation context stored instantly
 * - Long-Term Memory (LTM): Persistent information extracted via strategies (optional)
 *
 * This implementation uses STM only (no extraction strategies) for simple conversation history.
 */
export class Memory extends Construct {
    public readonly memory: AgentCoreMemory;
    public readonly memoryId: string;
    public readonly memoryArn: string;
    public readonly logGroup: LogGroup;

    constructor(scope: Construct, id: string, props: MemoryProps = {}) {
        super(scope, id);

        const {
            memoryName = Names.uniqueResourceName(this, { maxLength: 48 }),
            description = "Short-term memory for liveops",
            expirationDuration = Duration.days(7),
        } = props;

        // Create the AgentCore Memory using the official L2 construct
        // No memoryStrategies = short-term memory only (stores raw conversation turns)
        this.memory = new AgentCoreMemory(this, "Memory", {
            memoryName,
            description,
            expirationDuration,
            // memoryStrategies can be added here for long-term memory extraction:
            // memoryStrategies: [
            //     MemoryStrategy.usingBuiltInSummarization(),
            //     MemoryStrategy.usingBuiltInSemantic(),
            //     MemoryStrategy.usingBuiltInUserPreference(),
            // ]
        });

        this.memoryId = this.memory.memoryId;
        this.memoryArn = this.memory.memoryArn;

        // Create CloudWatch Log Group for memory logs
        // Note: Log delivery must be configured manually via AWS Console or CLI
        // See: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-configure.html
        this.logGroup = new LogGroup(this, "MemoryLogGroup", {
            logGroupName: `/aws/vendedlogs/bedrock-agentcore/memory/APPLICATION_LOGS/${memoryName}`,
            retention: RetentionDays.ONE_WEEK,
        });

        // Grant AgentCore Memory service permission to write to the log group
        this.logGroup.grantWrite(new ServicePrincipal("bedrock-agentcore.amazonaws.com"));
    }
}
