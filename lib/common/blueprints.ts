// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { InjectionContext, IPropertyInjector, RemovalPolicy } from "aws-cdk-lib";
import {
    Architecture,
    Function,
    FunctionProps,
    Runtime,
    RuntimeFamily,
} from "aws-cdk-lib/aws-lambda";
import { LogGroup, LogGroupProps, RetentionDays } from "aws-cdk-lib/aws-logs";
import { BlockPublicAccess, Bucket, BucketProps } from "aws-cdk-lib/aws-s3";

export class LogGroupInjector implements IPropertyInjector {
    public readonly constructUniqueId: string;

    constructor() {
        this.constructUniqueId = LogGroup.PROPERTY_INJECTION_ID;
    }

    public inject(originalProps: LogGroupProps): LogGroupProps {
        return {
            retention: RetentionDays.THREE_MONTHS,
            removalPolicy: RemovalPolicy.DESTROY,
            ...originalProps,
        };
    }
}

export class FunctionLogGroupInjector implements IPropertyInjector {
    public readonly constructUniqueId: string;

    constructor() {
        this.constructUniqueId = Function.PROPERTY_INJECTION_ID;
    }

    public inject(originalProps: FunctionProps, context: InjectionContext): FunctionProps {
        return {
            logGroup: new LogGroup(context.scope, `${context.id}LogGroup`),
            ...originalProps,
        };
    }
}

export class FunctionPlatformInjector implements IPropertyInjector {
    public readonly constructUniqueId: string;

    constructor() {
        this.constructUniqueId = Function.PROPERTY_INJECTION_ID;
    }

    public inject(originalProps: FunctionProps): FunctionProps {
        return {
            architecture: Architecture.ARM_64,
            ...originalProps,
            ...(originalProps.runtime.family === RuntimeFamily.NODEJS && {
                runtime: Runtime.NODEJS_22_X,
            }),
            ...(originalProps.runtime.family === RuntimeFamily.PYTHON && {
                runtime: Runtime.PYTHON_3_12,
            }),
        };
    }
}

export class BucketInjector implements IPropertyInjector {
    public readonly constructUniqueId: string;

    constructor() {
        this.constructUniqueId = Bucket.PROPERTY_INJECTION_ID;
    }

    public inject(originalProps: BucketProps, context: InjectionContext): BucketProps {
        return {
            ...(originalProps?.serverAccessLogsBucket && {
                serverAccessLogsPrefix: `${context.id}/`,
            }),
            autoDeleteObjects: true,
            ...originalProps,
            ...((originalProps?.autoDeleteObjects ?? true) && {
                removalPolicy: RemovalPolicy.DESTROY,
            }),
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
        };
    }
}

export function getPropertyInjectors(): IPropertyInjector[] {
    return [new LogGroupInjector(), new FunctionLogGroupInjector(), new BucketInjector()];
}
