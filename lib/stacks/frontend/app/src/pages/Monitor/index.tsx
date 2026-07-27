// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useState, useEffect } from "react";
import {
    Box,
    ContentLayout,
    Header,
    Select,
    SpaceBetween,
    StatusIndicator,
    Toggle,
} from "@cloudscape-design/components";
import { Report } from "../../services/monitor-service";
import { useMonitorContext } from "../../contexts/Monitor";
import { ThresholdConfig, PendingReport } from "./types";
import { getDemoScenario, setDemoScenario, DemoScenario } from "../../services/monitor-service";
import KpiCards from "./components/KpiCards";
import EventTimeline from "./components/EventTimeline";
import MetricThresholdList from "./components/MetricThresholdList";
import ReportsTable from "./components/ReportsTable";
import ReportDetailModal from "./components/ReportDetailModal";
import BreakdownsModal from "./components/BreakdownsModal";
import ThresholdSettingsModal from "./components/ThresholdSettingsModal";

const TIME_RANGE_OPTIONS = [
    { label: "Last 5 minutes", value: "5" },
    { label: "Last 15 minutes", value: "15" },
    { label: "Last 30 minutes", value: "30" },
    { label: "Last 1 hour", value: "60" },
    { label: "Last 2 hours", value: "120" },
];

const DEFAULT_THRESHOLDS: Record<string, ThresholdConfig> = {
    // Monitored (pattern detection rules)
    battle_error: { threshold: 100, windowSeconds: 90, autoReport: false },
    session_drop: { threshold: 200, windowSeconds: 90, autoReport: false },
    purchase_failure: { threshold: 50, windowSeconds: 90, autoReport: false },
    churn_signal: { threshold: 75, windowSeconds: 90, autoReport: false },
    api_abuse: { threshold: 25, windowSeconds: 90, autoReport: false },
    // General gameplay
    login: { threshold: 500, windowSeconds: 90, autoReport: false },
    logout: { threshold: 500, windowSeconds: 90, autoReport: false },
    session_end: { threshold: 500, windowSeconds: 90, autoReport: false },
    purchase: { threshold: 300, windowSeconds: 90, autoReport: false },
    level_complete: { threshold: 400, windowSeconds: 90, autoReport: false },
    arena_match: { threshold: 400, windowSeconds: 90, autoReport: false },
    // KB-aligned event types
    character_upgrade: { threshold: 300, windowSeconds: 90, autoReport: false },
    daily_activity: { threshold: 400, windowSeconds: 90, autoReport: false },
    event_participation: { threshold: 300, windowSeconds: 90, autoReport: false },
    gameplay_session: { threshold: 400, windowSeconds: 90, autoReport: false },
    guild_activity: { threshold: 300, windowSeconds: 90, autoReport: false },
    monetization_event: { threshold: 200, windowSeconds: 90, autoReport: false },
    social_interaction: { threshold: 300, windowSeconds: 90, autoReport: false },
};

export default function Monitor({
    onSendToChat,
}: {
    onSendToChat?: (prompt: string, report?: Report) => void;
}) {
    const {
        data,
        error,
        connected,
        isPolling,
        setIsPolling,
        timeRangeMinutes,
        setTimeRangeMinutes,
        updateRuleApi,
        requestAnalysisApi,
    } = useMonitorContext();

    const [selectedReport, setSelectedReport] = useState<Report | null>(null);
    const [showBreakdowns, setShowBreakdowns] = useState(false);
    const [thresholds, setThresholds] =
        useState<Record<string, ThresholdConfig>>(DEFAULT_THRESHOLDS);
    const [rulesLoaded, setRulesLoaded] = useState(false);
    const [editingMetric, setEditingMetric] = useState<string | null>(null);
    const [editValue, setEditValue] = useState("");
    const [editAutoReport, setEditAutoReport] = useState(false);
    const [pendingReports, setPendingReports] = useState<PendingReport[]>([]);
    const [analyzingMetric, setAnalyzingMetric] = useState<string | null>(null);

    // Demo heartbeat scenario picker — null means heartbeat is not enabled
    const [demoScenario, setDemoScenarioState] = useState<DemoScenario | null>(null);
    useEffect(() => {
        getDemoScenario().then(setDemoScenarioState);
    }, []);

    const handleScenarioChange = async (scenario: DemoScenario) => {
        setDemoScenarioState(scenario);
        await setDemoScenario(scenario).catch(console.error);
    };

    // Sync thresholds from backend rules on first successful load
    useEffect(() => {
        if (!data || rulesLoaded || !data.rules?.length) return;
        const updated: Record<string, ThresholdConfig> = {};
        for (const rule of data.rules) {
            updated[rule.event_type] = {
                threshold: rule.threshold,
                windowSeconds: (rule.window_minutes || 2) * 60,
                rule_id: rule.rule_id,
                description: rule.description,
                analysis_prompt: rule.analysis_prompt,
                autoReport: rule.auto_report || false,
            };
        }
        setThresholds((prev) => ({ ...prev, ...updated }));
        setRulesLoaded(true);
    }, [data, rulesLoaded]);

    // Clear pending reports that now have real reports
    useEffect(() => {
        if (!data?.reports?.length) return;
        setPendingReports((prev) =>
            prev.filter(
                (p) =>
                    !data.reports.some(
                        (r) => r.event_type === p.event_type && r.created_at > p.requested_at
                    )
            )
        );
        setAnalyzingMetric((prev) => {
            if (prev && data.reports.some((r) => r.event_type === prev)) return null;
            return prev;
        });
    }, [data?.reports]);

    const metrics = data?.metrics || [];
    const reports = data?.reports || [];
    const timeSeries = data?.timeSeries || [];
    const statusDot = !isPolling ? "⚪" : connected ? "🟢" : error ? "🔴" : "⚪";

    const getSeverity = (eventType: string): "success" | "warning" | "error" => {
        const cfg = thresholds[eventType];
        if (!cfg) return "warning";
        const metric = metrics.find((m) => m.event_type === eventType);
        const ratio = (metric?.total || 0) / cfg.threshold;
        return ratio >= 1 ? "error" : ratio >= 0.7 ? "warning" : "success";
    };

    const platformTotals: Record<string, number> = {};
    const regionTotals: Record<string, number> = {};
    let grandTotal = 0;
    for (const m of metrics) {
        grandTotal += m.total;
        for (const [p, c] of Object.entries(m.platforms)) {
            platformTotals[p] = (platformTotals[p] || 0) + c;
        }
        for (const [r, c] of Object.entries(m.regions)) {
            regionTotals[r] = (regionTotals[r] || 0) + c;
        }
    }

    const handleConfigureThreshold = (
        eventType: string,
        currentThreshold: number,
        autoReport: boolean
    ) => {
        setEditingMetric(eventType);
        setEditValue(String(currentThreshold));
        setEditAutoReport(autoReport);
    };

    const handleRequestAnalysis = (eventType: string, total: number, threshold: number) => {
        const cfg = thresholds[eventType];
        setAnalyzingMetric(eventType);
        const ratio = total / threshold;
        const currentSeverity: "success" | "warning" | "error" =
            ratio >= 1 ? "error" : ratio >= 0.7 ? "warning" : "success";
        setPendingReports((prev) => [
            {
                event_type: eventType,
                requested_at: new Date().toISOString(),
                severity: currentSeverity,
            },
            ...prev,
        ]);
        requestAnalysisApi({
            event_type: eventType,
            rule_id: cfg.rule_id || `${eventType}_spike`,
            current_count: total,
            threshold,
            description: cfg.description || `${eventType} analysis`,
            analysis_prompt:
                cfg.analysis_prompt ||
                `Analyze the current ${eventType} pattern. Check live metrics, identify affected platforms/regions, and recommend actions.`,
            window_minutes: Math.ceil(cfg.windowSeconds / 60),
        }).catch((err) => {
            console.error(err);
            setAnalyzingMetric(null);
            setPendingReports((prev) => prev.filter((p) => p.event_type !== eventType));
        });
    };

    const handleSaveThreshold = () => {
        const val = parseInt(editValue, 10);
        if (val > 0 && editingMetric) {
            const cfg = thresholds[editingMetric];
            setThresholds((prev) => ({
                ...prev,
                [editingMetric]: {
                    ...prev[editingMetric],
                    threshold: val,
                    autoReport: editAutoReport,
                },
            }));
            updateRuleApi({
                rule_id: cfg.rule_id || `${editingMetric}_spike`,
                event_type: editingMetric,
                threshold: val,
                window_minutes: Math.ceil(cfg.windowSeconds / 60),
                description: cfg.description || `${editingMetric} threshold`,
                analysis_prompt: cfg.analysis_prompt || `Analyze ${editingMetric} spike.`,
                auto_report: editAutoReport,
            }).catch(console.error);
        }
        setEditingMetric(null);
    };

    if (!data && !error) {
        return (
            <ContentLayout header={<Header variant="h1">⚪ Real-Time Monitoring</Header>}>
                <Box textAlign="center" padding={{ top: "xxxl" }}>
                    <StatusIndicator type="loading">Loading dashboard data…</StatusIndicator>
                </Box>
            </ContentLayout>
        );
    }

    return (
        <>
            <ContentLayout
                header={
                    <Header
                        variant="h1"
                        actions={
                            <SpaceBetween direction="horizontal" size="s">
                                {demoScenario !== null && (
                                    <Select
                                        selectedOption={{
                                            label: `🎬 ${demoScenario}`,
                                            value: demoScenario,
                                        }}
                                        onChange={({ detail }) =>
                                            handleScenarioChange(
                                                detail.selectedOption.value as DemoScenario
                                            )
                                        }
                                        options={[
                                            {
                                                label: "🌊 baseline — steady traffic",
                                                value: "baseline",
                                            },
                                            {
                                                label: "💥 spike — battle & session errors",
                                                value: "spike",
                                            },
                                            {
                                                label: "💳 purchase — payment failures",
                                                value: "purchase",
                                            },
                                            {
                                                label: "📉 churn — player churn signals",
                                                value: "churn",
                                            },
                                            {
                                                label: "🎲 random — random metric spike",
                                                value: "random",
                                            },
                                        ]}
                                    />
                                )}
                                <Select
                                    selectedOption={
                                        TIME_RANGE_OPTIONS.find(
                                            (o) => o.value === String(timeRangeMinutes)
                                        ) || TIME_RANGE_OPTIONS[3]
                                    }
                                    onChange={({ detail }) =>
                                        setTimeRangeMinutes(
                                            parseInt(detail.selectedOption.value || "60", 10)
                                        )
                                    }
                                    options={TIME_RANGE_OPTIONS}
                                />
                                <Toggle
                                    checked={isPolling}
                                    onChange={({ detail }) => setIsPolling(detail.checked)}
                                >
                                    Live
                                </Toggle>
                            </SpaceBetween>
                        }
                    >
                        {statusDot} Real-Time Monitoring
                    </Header>
                }
            >
                <SpaceBetween direction="vertical" size="l">
                    {error && (
                        <StatusIndicator type="error">Connection error: {error}</StatusIndicator>
                    )}

                    <KpiCards
                        grandTotal={grandTotal}
                        platformTotals={platformTotals}
                        regionTotals={regionTotals}
                        reportCount={reports.length}
                        onShowBreakdowns={() => setShowBreakdowns(true)}
                    />

                    <EventTimeline timeSeries={timeSeries} timeRangeMinutes={timeRangeMinutes} />

                    <MetricThresholdList
                        thresholds={thresholds}
                        timeSeries={timeSeries}
                        analyzingMetric={analyzingMetric}
                        onConfigureThreshold={handleConfigureThreshold}
                        onRequestAnalysis={handleRequestAnalysis}
                    />

                    <ReportsTable
                        reports={reports}
                        pendingReports={pendingReports}
                        getSeverity={getSeverity}
                        onSelectReport={setSelectedReport}
                    />
                </SpaceBetween>
            </ContentLayout>

            <ReportDetailModal
                report={selectedReport}
                onDismiss={() => setSelectedReport(null)}
                onSendToChat={onSendToChat}
            />

            <BreakdownsModal
                visible={showBreakdowns}
                onDismiss={() => setShowBreakdowns(false)}
                platformTotals={platformTotals}
                regionTotals={regionTotals}
                grandTotal={grandTotal}
            />

            <ThresholdSettingsModal
                editingMetric={editingMetric}
                editValue={editValue}
                editAutoReport={editAutoReport}
                onEditValueChange={setEditValue}
                onEditAutoReportChange={setEditAutoReport}
                onSave={handleSaveThreshold}
                onDismiss={() => setEditingMetric(null)}
            />
        </>
    );
}
