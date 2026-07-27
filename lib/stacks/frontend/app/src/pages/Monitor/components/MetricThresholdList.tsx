// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useCallback, useEffect, useRef, useState } from "react";
import {
    Box,
    Button,
    Container,
    Header,
    Icon,
    StatusIndicator,
} from "@cloudscape-design/components";
import { TimeSeriesBucket } from "../../../services/monitor-service";
import { ThresholdConfig } from "../types";

interface MetricThresholdListProps {
    thresholds: Record<string, ThresholdConfig>;
    timeSeries: TimeSeriesBucket[];
    analyzingMetric: string | null;
    onConfigureThreshold: (
        eventType: string,
        currentThreshold: number,
        autoReport: boolean
    ) => void;
    onRequestAnalysis: (eventType: string, total: number, threshold: number) => void;
}

export default function MetricThresholdList({
    thresholds,
    timeSeries,
    analyzingMetric,
    onConfigureThreshold,
    onRequestAnalysis,
}: MetricThresholdListProps) {
    const now = Date.now();

    const items = Object.entries(thresholds).map(([et, cfg]) => {
        const cutoff = now - cfg.windowSeconds * 1000;
        const recentCount = timeSeries
            .filter((b) => b.event_type === et && new Date(b.timestamp).getTime() >= cutoff)
            .reduce((sum, b) => sum + b.count, 0);

        return {
            event_type: et,
            total: recentCount,
            threshold: cfg.threshold,
            windowSeconds: cfg.windowSeconds,
        };
    });

    items.sort((a, b) => b.total / b.threshold - a.total / a.threshold);

    return (
        <Container
            header={
                <Header
                    variant="h3"
                    description={
                        <span style={{ display: "inline-flex", gap: 16, flexWrap: "wrap" }}>
                            <span>
                                <Icon name="settings" /> Configure thresholds
                            </span>
                            <span>
                                <Icon name="search-gen-ai" /> Generate AI analysis report
                            </span>
                        </span>
                    }
                    counter={`(${Object.keys(thresholds).length})`}
                >
                    Live Metrics &amp; Thresholds
                </Header>
            }
        >
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                    gap: 10,
                }}
            >
                {items.map((item) => {
                    const ratio = item.total / item.threshold;
                    const severity: "success" | "warning" | "error" =
                        ratio >= 1 ? "error" : ratio >= 0.7 ? "warning" : "success";
                    const bgColor =
                        severity === "error"
                            ? "rgba(209,55,55,0.08)"
                            : severity === "warning"
                              ? "rgba(255,153,0,0.08)"
                              : "rgba(29,129,2,0.05)";
                    const borderColor =
                        severity === "error"
                            ? "#d13737"
                            : severity === "warning"
                              ? "#ff9900"
                              : "#1d8102";

                    return (
                        <div
                            key={item.event_type}
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 6,
                                padding: "10px 12px",
                                borderRadius: 8,
                                borderLeft: `4px solid ${borderColor}`,
                                background: bgColor,
                            }}
                        >
                            {/* Row 1: label + actions */}
                            <div
                                style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                }}
                            >
                                <StatusIndicator type={severity}>
                                    {item.event_type.replace(/_/g, " ")}
                                </StatusIndicator>
                                <div style={{ display: "flex", gap: 2 }}>
                                    <Button
                                        variant="icon"
                                        iconName="settings"
                                        ariaLabel="Configure threshold"
                                        onClick={() =>
                                            onConfigureThreshold(
                                                item.event_type,
                                                item.threshold,
                                                thresholds[item.event_type]?.autoReport || false
                                            )
                                        }
                                    />
                                    <Button
                                        variant="icon"
                                        iconName="search-gen-ai"
                                        ariaLabel="Generate AI analysis report"
                                        loading={analyzingMetric === item.event_type}
                                        disabled={analyzingMetric === item.event_type}
                                        onClick={() =>
                                            onRequestAnalysis(
                                                item.event_type,
                                                item.total,
                                                item.threshold
                                            )
                                        }
                                    />
                                </div>
                            </div>
                            {/* Row 2: sparkline + count */}
                            <div
                                style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "flex-end",
                                    gap: 8,
                                }}
                            >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <Sparkline
                                        eventType={item.event_type}
                                        timeSeries={timeSeries}
                                        color={borderColor}
                                    />
                                </div>
                                <div
                                    style={{
                                        textAlign: "right",
                                        whiteSpace: "nowrap",
                                        flexShrink: 0,
                                    }}
                                >
                                    <Box variant="h3" display="inline">
                                        {item.total}
                                    </Box>
                                    <Box variant="small" color="text-body-secondary">
                                        {" "}
                                        / {item.threshold} in 60s
                                    </Box>
                                </div>
                            </div>
                            {/* Progress bar */}
                            <div
                                style={{
                                    height: 4,
                                    borderRadius: 2,
                                    background: "rgba(128,128,128,0.15)",
                                    overflow: "hidden",
                                }}
                            >
                                <div
                                    style={{
                                        width: `${Math.min(ratio * 100, 100)}%`,
                                        height: "100%",
                                        borderRadius: 2,
                                        background: borderColor,
                                        transition: "width 0.4s ease",
                                    }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </Container>
    );
}

function Sparkline({
    eventType,
    timeSeries,
    color,
}: {
    eventType: string;
    timeSeries: TimeSeriesBucket[];
    color: string;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(80);

    const measure = useCallback(() => {
        if (containerRef.current) {
            setWidth(containerRef.current.offsetWidth);
        }
    }, []);

    useEffect(() => {
        measure();
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [measure]);

    const numSlots = 10;
    const now = new Date();
    const slots: number[] = [];

    const countByMinute = new Map<number, number>();
    for (const b of timeSeries) {
        if (b.event_type !== eventType) continue;
        const d = new Date(b.timestamp);
        d.setSeconds(0, 0);
        countByMinute.set(d.getTime(), b.count);
    }

    const sparkNow = new Date(now);
    sparkNow.setSeconds(0, 0);
    for (let i = numSlots; i >= 1; i--) {
        const slotTime = new Date(sparkNow.getTime() - i * 60_000);
        slots.push(countByMinute.get(slotTime.getTime()) || 0);
    }

    const max = Math.max(...slots, 1);
    const h = 28;
    const w = Math.max(width, 40);
    const step = w / (slots.length - 1);
    const path = slots
        .map((v, i) => `${i === 0 ? "M" : "L"}${i * step},${h - (v / max) * h}`)
        .join(" ");

    return (
        <div ref={containerRef} style={{ width: "100%" }}>
            <svg width={w} height={h} style={{ display: "block" }}>
                <path d={path} fill="none" stroke={color} strokeWidth={2} />
            </svg>
        </div>
    );
}
