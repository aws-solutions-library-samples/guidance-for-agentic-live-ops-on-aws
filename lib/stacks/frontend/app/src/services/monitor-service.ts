// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Monitor API Service — polls the monitor Lambda for live metrics and reports.
 */
import { Sha256 } from "@aws-crypto/sha256-js";
import { HttpRequest } from "@aws-sdk/protocol-http";
import { SignatureV4 } from "@aws-sdk/signature-v4";
import { fetchAuthSession } from "aws-amplify/auth";

export interface MetricSummary {
    event_type: string;
    total: number;
    platforms: Record<string, number>;
    regions: Record<string, number>;
}

export interface ReportArtifacts {
    data_points: Array<{
        event_type: string;
        time_range_minutes: number;
        total_count: number;
        platforms: Record<string, number>;
        regions: Record<string, number>;
    }>;
    kb_sources: Array<{
        source_index: number;
        relevance_score: number;
        content: string;
        source_uri: string;
    }>;
    athena_queries: Array<{
        sql: string;
        row_count: number;
        columns: string[];
        sample_rows: string[][];
    }>;
    remediation_sources: Array<{
        source_index: number;
        relevance_score: number;
        content: string;
        source_uri: string;
    }>;
}

export interface Report {
    report_id: string;
    created_at: string;
    rule_id: string;
    event_type: string;
    analysis: string;
    trigger_context: string;
    severity?: "success" | "warning" | "error";
    current_count?: number;
    threshold?: number;
    artifacts?: ReportArtifacts;
}

export interface TimeSeriesBucket {
    timestamp: string;
    event_type: string;
    count: number;
}

export interface PatternRule {
    rule_id: string;
    event_type: string;
    threshold: number;
    window_minutes: number;
    description: string;
    analysis_prompt: string;
    auto_report?: boolean;
}

export interface MonitorData {
    metrics: MetricSummary[];
    reports: Report[];
    timeSeries: TimeSeriesBucket[];
    rules: PatternRule[];
    timestamp: string;
}

export async function fetchMonitorData(timeRange = 30, reportLimit = 10): Promise<MonitorData> {
    const session = await fetchAuthSession();
    const credentials = session.credentials;
    if (!credentials) throw new Error("No credentials available");

    const monitorUrl = import.meta.env.VITE_MONITOR_FUNCTION_URL;
    if (!monitorUrl) throw new Error("VITE_MONITOR_FUNCTION_URL not configured");

    const url = new URL(monitorUrl);

    const request = new HttpRequest({
        method: "GET",
        protocol: url.protocol,
        hostname: url.hostname,
        path: url.pathname || "/",
        query: { time_range: String(timeRange), report_limit: String(reportLimit) },
        headers: {
            host: url.hostname,
            "x-amz-content-sha256":
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", // SHA256 of empty body
        },
    });

    const signer = new SignatureV4({
        service: "lambda",
        region: import.meta.env.VITE_REGION,
        credentials,
        sha256: Sha256,
    });

    const signed = await signer.sign(request);

    const fetchUrl = `${url.origin}${url.pathname || "/"}?time_range=${timeRange}&report_limit=${reportLimit}`;
    const resp = await fetch(fetchUrl, {
        method: "GET",
        headers: signed.headers as HeadersInit,
    });

    if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`Monitor API error: ${resp.status} ${body}`);
    }
    return resp.json();
}

export async function updateRule(rule: PatternRule): Promise<void> {
    const session = await fetchAuthSession();
    const credentials = session.credentials;
    if (!credentials) throw new Error("No credentials available");

    const monitorUrl = import.meta.env.VITE_MONITOR_FUNCTION_URL;
    if (!monitorUrl) throw new Error("VITE_MONITOR_FUNCTION_URL not configured");

    const url = new URL(monitorUrl);
    const body = JSON.stringify(rule);
    const hash = new Sha256();
    hash.update(body);
    const bodyHash = await hash.digest();
    const hashHex = Array.from(new Uint8Array(bodyHash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    const request = new HttpRequest({
        method: "PUT",
        protocol: url.protocol,
        hostname: url.hostname,
        path: (url.pathname || "/") + "rules",
        headers: {
            host: url.hostname,
            "content-type": "application/json",
            "x-amz-content-sha256": hashHex,
        },
        body,
    });

    const signer = new SignatureV4({
        service: "lambda",
        region: import.meta.env.VITE_REGION,
        credentials,
        sha256: Sha256,
    });

    const signed = await signer.sign(request);

    const resp = await fetch(`${url.origin}${url.pathname || "/"}rules`, {
        method: "PUT",
        headers: signed.headers as HeadersInit,
        body,
    });

    if (!resp.ok) {
        const respBody = await resp.text().catch(() => "");
        throw new Error(`Failed to update rule: ${resp.status} ${respBody}`);
    }
}

export async function requestAnalysis(params: {
    event_type: string;
    rule_id?: string;
    current_count?: number;
    threshold?: number;
    description?: string;
    analysis_prompt?: string;
    window_minutes?: number;
}): Promise<void> {
    const session = await fetchAuthSession();
    const credentials = session.credentials;
    if (!credentials) throw new Error("No credentials available");

    const monitorUrl = import.meta.env.VITE_MONITOR_FUNCTION_URL;
    if (!monitorUrl) throw new Error("VITE_MONITOR_FUNCTION_URL not configured");

    const url = new URL(monitorUrl);
    const body = JSON.stringify(params);
    const hash = new Sha256();
    hash.update(body);
    const bodyHash = await hash.digest();
    const hashHex = Array.from(new Uint8Array(bodyHash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    const request = new HttpRequest({
        method: "POST",
        protocol: url.protocol,
        hostname: url.hostname,
        path: (url.pathname || "/") + "analyze",
        headers: {
            host: url.hostname,
            "content-type": "application/json",
            "x-amz-content-sha256": hashHex,
        },
        body,
    });

    const signer = new SignatureV4({
        service: "lambda",
        region: import.meta.env.VITE_REGION,
        credentials,
        sha256: Sha256,
    });

    const signed = await signer.sign(request);

    const resp = await fetch(`${url.origin}${url.pathname || "/"}analyze`, {
        method: "POST",
        headers: signed.headers as HeadersInit,
        body,
    });

    if (!resp.ok) {
        const respBody = await resp.text().catch(() => "");
        throw new Error(`Failed to request analysis: ${resp.status} ${respBody}`);
    }
}

export type DemoScenario = "baseline" | "spike" | "purchase" | "churn" | "random";

async function signedMonitorFetch(method: string, path: string, body?: unknown): Promise<Response> {
    const session = await fetchAuthSession();
    const credentials = session.credentials;
    if (!credentials) throw new Error("No credentials available");

    const monitorUrl = import.meta.env.VITE_MONITOR_FUNCTION_URL;
    if (!monitorUrl) throw new Error("VITE_MONITOR_FUNCTION_URL not configured");

    const url = new URL(monitorUrl);
    const bodyStr = body ? JSON.stringify(body) : undefined;

    const hash = new Sha256();
    if (bodyStr) hash.update(bodyStr);
    const bodyHash = await hash.digest();
    const hashHex = Array.from(new Uint8Array(bodyHash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    const request = new HttpRequest({
        method,
        protocol: url.protocol,
        hostname: url.hostname,
        path: (url.pathname || "/") + path,
        headers: {
            host: url.hostname,
            "content-type": "application/json",
            "x-amz-content-sha256": hashHex,
        },
        ...(bodyStr ? { body: bodyStr } : {}),
    });

    const signed = await new SignatureV4({
        service: "lambda",
        region: import.meta.env.VITE_REGION,
        credentials,
        sha256: Sha256,
    }).sign(request);

    return fetch(`${url.origin}${url.pathname || "/"}${path}`, {
        method,
        headers: signed.headers as HeadersInit,
        ...(bodyStr ? { body: bodyStr } : {}),
    });
}

export async function getDemoScenario(): Promise<DemoScenario | null> {
    try {
        const resp = await signedMonitorFetch("GET", "demo/scenario");
        if (resp.status === 404) return null; // heartbeat not enabled
        if (!resp.ok) throw new Error(`${resp.status}`);
        const data = await resp.json();
        return data.scenario as DemoScenario;
    } catch {
        return null;
    }
}

export async function setDemoScenario(scenario: DemoScenario): Promise<void> {
    const resp = await signedMonitorFetch("POST", "demo/scenario", { scenario });
    if (!resp.ok) throw new Error(`Failed to set scenario: ${resp.status}`);
}
