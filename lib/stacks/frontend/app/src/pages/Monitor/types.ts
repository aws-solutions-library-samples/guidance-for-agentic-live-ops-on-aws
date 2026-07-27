// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export interface ThresholdConfig {
    threshold: number;
    windowSeconds: number;
    rule_id?: string;
    description?: string;
    analysis_prompt?: string;
    autoReport?: boolean;
}

export interface PendingReport {
    event_type: string;
    requested_at: string;
    severity: "success" | "warning" | "error";
}
