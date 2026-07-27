// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Duration, Names } from "aws-cdk-lib";
import { Stream } from "aws-cdk-lib/aws-kinesis";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { PythonFunction } from "@aws-cdk/aws-lambda-python-alpha";
import { CfnSchedule } from "aws-cdk-lib/aws-scheduler";
import { Role, ServicePrincipal, PolicyStatement, Effect } from "aws-cdk-lib/aws-iam";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { join } from "path";

export type DemoScenario = "baseline" | "spike" | "purchase" | "churn" | "random";

export interface DemoHeartbeatConfig {
    /** Whether to deploy the heartbeat. Default: false */
    enabled?: boolean;
    /** Traffic scenario. Default: "baseline" */
    scenario?: DemoScenario;
    /** How often to fire, in seconds. Min 60. Default: 60 */
    intervalSeconds?: number;
    /** Events per invocation. Default: 150 */
    batchSize?: number;
    /** Probability (0–1) of injecting a random spike in baseline mode. Default: 0.15 */
    spikeProbability?: number;
}

export interface DemoHeartbeatProps {
    gameEventStream: Stream;
    config: DemoHeartbeatConfig;
}

/**
 * Optional demo construct that continuously pushes synthetic game events to Kinesis
 * so the monitoring dashboard always has live data during demos.
 *
 * Enable via cdk.json context:
 *   "demoHeartbeat": { "enabled": true, "scenario": "baseline", "intervalSeconds": 60 }
 *
 * The active scenario can be changed at runtime from the Monitor dashboard without redeployment.
 * It is stored in SSM Parameter Store and read by the Lambda on each invocation.
 */
export class DemoHeartbeat extends Construct {
    /** SSM parameter for the active scenario, exposed to the monitor API */
    public readonly scenarioParameter: StringParameter;

    constructor(scope: Construct, id: string, props: DemoHeartbeatProps) {
        super(scope, id);

        const { gameEventStream, config } = props;

        const scenario = config.scenario ?? "baseline";
        const intervalSeconds = Math.max(60, config.intervalSeconds ?? 60);
        const batchSize = config.batchSize ?? 150;
        const spikeProbability = config.spikeProbability ?? 0.15;

        // SSM parameter holds the active scenario — updated from the dashboard at runtime
        const scenarioParam = new StringParameter(this, "scenarioParam", {
            parameterName: `/${Names.uniqueResourceName(this, { maxLength: 40 })}/scenario`,
            stringValue: scenario,
            description: "Active demo heartbeat scenario (baseline|spike|purchase|churn|random)",
        });
        this.scenarioParameter = scenarioParam;

        // Lambda that generates and pushes synthetic events
        const heartbeatFn = new PythonFunction(this, "fn", {
            entry: join(__dirname, "runtime"),
            index: "heartbeat.py",
            handler: "handler",
            runtime: Runtime.PYTHON_3_13,
            architecture: Architecture.ARM_64,
            timeout: Duration.seconds(30),
            memorySize: 128,
            environment: {
                STREAM_NAME: gameEventStream.streamName,
                SCENARIO_PARAM: scenarioParam.parameterName,
                SCENARIO_DEFAULT: scenario,
                BATCH_SIZE: String(batchSize),
                SPIKE_PROBABILITY: String(spikeProbability),
            },
        });

        // Least-privilege permissions
        heartbeatFn.addToRolePolicy(
            new PolicyStatement({
                sid: "KinesisPutRecords",
                effect: Effect.ALLOW,
                actions: ["kinesis:PutRecords"],
                resources: [gameEventStream.streamArn],
            })
        );
        // Scoped to this construct's own scenario parameter only
        scenarioParam.grantRead(heartbeatFn);

        // IAM role for EventBridge Scheduler to invoke the Lambda
        const schedulerRole = new Role(this, "schedulerRole", {
            assumedBy: new ServicePrincipal("scheduler.amazonaws.com"),
        });
        heartbeatFn.grantInvoke(schedulerRole);

        // EventBridge Scheduler — rate expression (minimum 1 minute)
        const minutes = Math.ceil(intervalSeconds / 60);
        const rateExpr = minutes === 1 ? "rate(1 minute)" : `rate(${minutes} minutes)`;

        new CfnSchedule(this, "schedule", {
            name: `${Names.uniqueResourceName(this, { maxLength: 50 })}-heartbeat`,
            scheduleExpression: rateExpr,
            flexibleTimeWindow: { mode: "OFF" },
            target: {
                arn: heartbeatFn.functionArn,
                roleArn: schedulerRole.roleArn,
                input: JSON.stringify({ source: "demo-heartbeat" }),
            },
            state: "ENABLED",
        });
    }
}
