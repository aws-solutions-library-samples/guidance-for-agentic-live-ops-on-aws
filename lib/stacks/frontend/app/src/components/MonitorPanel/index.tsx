// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Header from "@cloudscape-design/components/header";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import TextContent from "@cloudscape-design/components/text-content";
import Toggle from "@cloudscape-design/components/toggle";
import { useMonitorContext } from "../../contexts/Monitor";
import { Report } from "../../services/monitor-service";

interface MonitorPanelProps {
    onAskAbout?: (text: string) => void;
}

export type AlertStatus = "detected" | "analyzing" | "ready";

export interface AlertCard {
    id: string;
    ruleId: string;
    eventType: string;
    count: number;
    threshold: number;
    description: string;
    status: AlertStatus;
    timestamp: string;
    report?: Report;
}

function alertColor(status: AlertCard["status"]): string {
    switch (status) {
        case "detected":
            return "#ff9900"; // amber
        case "analyzing":
            return "#ff9900";
        case "ready":
            return "#1d8102"; // green
    }
}

function alertLabel(status: AlertCard["status"]): string {
    switch (status) {
        case "detected":
            return "Pattern Detected";
        case "analyzing":
            return "Generating Report…";
        case "ready":
            return "Report Ready";
    }
}

function AlertCardItem({
    alert,
    onViewReport,
    onAskAbout,
    onDismiss,
}: {
    alert: AlertCard;
    onViewReport: (alert: AlertCard) => void;
    onAskAbout: (alert: AlertCard) => void;
    onDismiss: (id: string) => void;
}) {
    const isReady = alert.status === "ready";
    const isPulsing = alert.status === "analyzing";

    return (
        <div
            style={{
                border: `2px solid ${alertColor(alert.status)}`,
                borderRadius: 8,
                padding: 12,
                marginBottom: 8,
                background: isReady ? "rgba(29,129,2,0.06)" : "rgba(255,153,0,0.06)",
                animation: isPulsing ? "pulse 1.5s ease-in-out infinite" : undefined,
                position: "relative",
            }}
        >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                    <Box variant="small">
                        <StatusIndicator type={isReady ? "success" : "warning"}>
                            {alertLabel(alert.status)}
                        </StatusIndicator>
                    </Box>
                    <Box variant="small" color="text-body-secondary">
                        {new Date(alert.timestamp).toLocaleDateString()}{" "}
                        {new Date(alert.timestamp).toLocaleTimeString()}
                    </Box>
                </div>
                <Button
                    variant="icon"
                    iconName="close"
                    onClick={() => onDismiss(alert.id)}
                    ariaLabel="Dismiss alert"
                />
            </div>

            <Box variant="h4" margin={{ top: "xxs" }}>
                {alert.eventType.replace(/_/g, " ")}
            </Box>

            <Box variant="small" color="text-body-secondary">
                {alert.description}
            </Box>

            {alert.count > 0 && (
                <Box variant="small" margin={{ top: "xxs" }}>
                    {alert.count} events (threshold: {alert.threshold})
                </Box>
            )}

            {isReady && (
                <SpaceBetween direction="horizontal" size="xs">
                    {alert.report && (
                        <Button
                            variant="icon"
                            iconName="view-full"
                            onClick={() => onViewReport(alert)}
                            ariaLabel="View full report"
                        />
                    )}
                    <Button
                        variant="icon"
                        iconName="contact"
                        onClick={() => onAskAbout(alert)}
                        ariaLabel="Ask about this"
                    />
                </SpaceBetween>
            )}
        </div>
    );
}

export default function MonitorPanel({ onAskAbout }: MonitorPanelProps) {
    const { data, error, connected, isPolling, setIsPolling } = useMonitorContext();
    const [alerts, setAlerts] = useState<AlertCard[]>([]);
    const [selectedAlert, setSelectedAlert] = useState<AlertCard | null>(null);
    const seenReports = useRef(new Set<string>());
    const dismissedReports = useRef(new Set<string>());

    // Build alerts from shared context data
    useEffect(() => {
        if (!data) return;

        const fallbackRules: Record<string, { threshold: number; description: string }> = {
            battle_error: { threshold: 50, description: "Battle error rate spike" },
            session_drop: { threshold: 100, description: "Abnormal session drops" },
            purchase_failure: { threshold: 20, description: "Purchase failures elevated" },
            churn_signal: { threshold: 30, description: "High churn signal volume" },
            api_abuse: { threshold: 15, description: "Potential API abuse or hacking attempt" },
        };

        const thresholds: Record<string, { threshold: number; description: string }> = {};
        if (data.rules && data.rules.length > 0) {
            for (const rule of data.rules) {
                thresholds[rule.event_type] = {
                    threshold: rule.threshold,
                    description:
                        rule.description ||
                        `${rule.event_type.replace(/_/g, " ")} threshold breached`,
                };
            }
        } else {
            Object.assign(thresholds, fallbackRules);
        }

        setAlerts((prev) => {
            const updated = [...prev];

            for (const metric of data.metrics) {
                const rule = thresholds[metric.event_type];
                if (!rule || metric.total < rule.threshold) continue;
                if (dismissedReports.current.has(`metric:${metric.event_type}`)) continue;

                const existingIdx = updated.findIndex(
                    (a) => a.eventType === metric.event_type && a.status !== "ready"
                );

                if (existingIdx === -1) {
                    const hasReady = updated.some(
                        (a) => a.eventType === metric.event_type && a.status === "ready"
                    );
                    if (hasReady) continue;

                    updated.push({
                        id: `alert-${metric.event_type}-${Date.now()}`,
                        ruleId: `${metric.event_type}_spike`,
                        eventType: metric.event_type,
                        count: metric.total,
                        threshold: rule.threshold,
                        description: rule.description,
                        status: "detected",
                        timestamp: data.timestamp,
                    });
                } else {
                    updated[existingIdx].count = metric.total;
                }
            }

            for (const report of data.reports) {
                if (seenReports.current.has(report.report_id)) continue;
                if (dismissedReports.current.has(report.report_id)) continue;

                const alertIdx = updated.findIndex(
                    (a) =>
                        a.eventType === report.event_type &&
                        (a.status === "detected" || a.status === "analyzing")
                );

                if (alertIdx !== -1) {
                    updated[alertIdx].status = "ready";
                    updated[alertIdx].report = report;
                    seenReports.current.add(report.report_id);
                } else {
                    updated.push({
                        id: `alert-${report.event_type}-${Date.now()}`,
                        ruleId: report.rule_id,
                        eventType: report.event_type,
                        count: 0,
                        threshold: 0,
                        description: `Analysis: ${report.rule_id}`,
                        status: "ready",
                        timestamp: report.created_at,
                        report,
                    });
                    seenReports.current.add(report.report_id);
                }
            }

            for (const alert of updated) {
                if (alert.status === "detected") {
                    const age = Date.now() - new Date(alert.timestamp).getTime();
                    if (age > 5000) alert.status = "analyzing";
                }
            }

            return updated;
        });
    }, [data]);

    const dismissAlert = useCallback((id: string) => {
        setAlerts((prev) => {
            const alert = prev.find((a) => a.id === id);
            if (alert?.report) {
                dismissedReports.current.add(alert.report.report_id);
            }
            if (alert) {
                dismissedReports.current.add(`metric:${alert.eventType}`);
            }
            return prev.filter((a) => a.id !== id);
        });
    }, []);

    const handleAskAbout = (alert: AlertCard) => {
        const context = alert.report
            ? `A real-time monitoring alert was triggered: "${alert.description}" with ${alert.count} ${alert.eventType.replace(/_/g, " ")} events (threshold: ${alert.threshold}). An initial analysis report found: ${alert.report.analysis}\n\nPlease query the live metrics for the latest ${alert.eventType} data and cross-reference with the knowledge base to provide deeper insights. What's causing this and what actions should we take?`
            : `A real-time monitoring alert was triggered: "${alert.description}" with ${alert.count} ${alert.eventType.replace(/_/g, " ")} events in the last 30 minutes (threshold: ${alert.threshold}). Please query the live metrics for ${alert.eventType} and analyze what's happening. What's the root cause and what should we do?`;
        onAskAbout?.(context);
    };

    const statusDot = !isPolling ? "⚪" : connected ? "🟢" : error ? "🔴" : "⚪";

    return (
        <div style={{ padding: "4px 16px", marginTop: 8 }}>
            <SpaceBetween direction="vertical" size="s">
                <Header variant="h3">{statusDot} Real-Time Monitor</Header>

                <Toggle checked={isPolling} onChange={({ detail }) => setIsPolling(detail.checked)}>
                    Live
                </Toggle>

                {error && <StatusIndicator type="error">Connection error: {error}</StatusIndicator>}

                {alerts.length === 0 && !error && (
                    <Box textAlign="center" color="text-body-secondary" padding="l">
                        <TextContent>
                            <p>
                                No active alerts. The monitor is watching for anomalous patterns in
                                real-time game data.
                            </p>
                        </TextContent>
                    </Box>
                )}

                {[...alerts]
                    .sort(
                        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
                    )
                    .map((alert) => (
                        <AlertCardItem
                            key={alert.id}
                            alert={alert}
                            onViewReport={setSelectedAlert}
                            onAskAbout={handleAskAbout}
                            onDismiss={dismissAlert}
                        />
                    ))}
            </SpaceBetween>

            {/* Report Modal */}
            {selectedAlert?.report && (
                <Modal
                    visible={!!selectedAlert}
                    onDismiss={() => setSelectedAlert(null)}
                    header={`Report: ${selectedAlert.eventType.replace(/_/g, " ")}`}
                    size="large"
                    footer={
                        <Box float="right">
                            <SpaceBetween direction="horizontal" size="xs">
                                <Button
                                    variant="link"
                                    onClick={() => {
                                        handleAskAbout(selectedAlert);
                                        setSelectedAlert(null);
                                    }}
                                >
                                    Ask about this
                                </Button>
                                <Button variant="primary" onClick={() => setSelectedAlert(null)}>
                                    Close
                                </Button>
                            </SpaceBetween>
                        </Box>
                    }
                >
                    <SpaceBetween direction="vertical" size="m">
                        <Box variant="small" color="text-body-secondary">
                            Rule: {selectedAlert.report.rule_id} · Generated:{" "}
                            {new Date(selectedAlert.report.created_at).toLocaleString()}
                        </Box>
                        <TextContent>
                            <div style={{ whiteSpace: "pre-wrap" }}>
                                {selectedAlert.report.analysis}
                            </div>
                        </TextContent>
                    </SpaceBetween>
                </Modal>
            )}

            {/* Pulse animation */}
            <style>{`
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.6; }
                }
            `}</style>
        </div>
    );
}
