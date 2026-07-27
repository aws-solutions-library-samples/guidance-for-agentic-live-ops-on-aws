// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { App, Tags } from "aws-cdk-lib";
import { getPropertyInjectors } from "../lib/common/blueprints";
import { ApplicationStage } from "../lib/stage";

const app = new App({
    propertyInjectors: getPropertyInjectors(),
});

const projectId = app.node.tryGetContext("projectId");
if (projectId) Tags.of(app).add("projectId", projectId);

const stage = app.node.tryGetContext("stage");

new ApplicationStage(app, stage || "dev");

app.synth();
