// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Box, Container, Header, LineChart } from "@cloudscape-design/components";
import { TimeSeriesBucket } from "../../../services/monitor-service";

interface EventTimelineProps {
    timeSeries: TimeSeriesBucket[];
    timeRangeMinutes: number;
}

export default function EventTimeline({ timeSeries, timeRangeMinutes }: EventTimelineProps) {
    return (
        <Container header={<Header variant="h3">Event Volume Over Time (2-min intervals)</Header>}>
            {timeSeries.length > 0 ? (
                (() => {
                    const eventTypes = [...new Set(timeSeries.map((b) => b.event_type))];

                    const now = new Date();
                    const windowStart = new Date(now.getTime() - timeRangeMinutes * 60 * 1000);
                    windowStart.setSeconds(0, 0);

                    const bucketMs =
                        timeRangeMinutes <= 15
                            ? 60_000
                            : timeRangeMinutes <= 60
                              ? 2 * 60_000
                              : 5 * 60_000;

                    // Index time-series data into buckets
                    const dataIndex = new Map<string, number>();
                    for (const b of timeSeries) {
                        const ts = new Date(b.timestamp).getTime();
                        const bucketStart =
                            Math.floor((ts - windowStart.getTime()) / bucketMs) * bucketMs +
                            windowStart.getTime();
                        const key = `${b.event_type}|${bucketStart}`;
                        dataIndex.set(key, (dataIndex.get(key) || 0) + b.count);
                    }

                    // End the domain 2 minutes ago to avoid trailing empty space
                    // from incomplete/in-flight buckets
                    const domainEnd = new Date(now.getTime() - 2 * 60_000);
                    domainEnd.setSeconds(0, 0);

                    // Build all possible slots in the window
                    const allSlots: Date[] = [];
                    for (
                        let t = new Date(windowStart);
                        t <= domainEnd;
                        t = new Date(t.getTime() + bucketMs)
                    ) {
                        allSlots.push(new Date(t));
                    }

                    // Always use the full selected time window as the x-domain
                    const slots = allSlots;
                    const domainStart = windowStart;

                    // Split each event type into separate segments so gaps
                    // (slots with no data) break the line instead of connecting.
                    const colorMap: Record<string, string> = {};
                    const palette = [
                        "#688ae8",
                        "#c33d69",
                        "#2ea597",
                        "#8b5cf6",
                        "#e07941",
                        "#3b82f6",
                        "#ec4899",
                        "#10b981",
                    ];
                    eventTypes.forEach((et, i) => {
                        colorMap[et] = palette[i % palette.length];
                    });

                    const series = eventTypes.flatMap((et) => {
                        const label = et.replace(/_/g, " ");
                        const segments: { x: Date; y: number }[][] = [];
                        let current: { x: Date; y: number }[] = [];

                        for (const slot of slots) {
                            const val = dataIndex.get(`${et}|${slot.getTime()}`);
                            if (val !== undefined && val > 0) {
                                current.push({ x: slot, y: val });
                            } else {
                                if (current.length > 0) {
                                    segments.push(current);
                                    current = [];
                                }
                            }
                        }
                        if (current.length > 0) segments.push(current);

                        // Only the first segment gets a visible legend label.
                        // Subsequent segments share the same color but use an
                        // empty title so they don't duplicate in the legend.
                        return segments.map((seg, i) => ({
                            title: i === 0 ? label : "",
                            type: "line" as const,
                            color: colorMap[et],
                            data: seg,
                        }));
                    });

                    const maxY = Math.max(...series.flatMap((s) => s.data.map((d) => d.y)), 1);

                    return (
                        <LineChart
                            series={series}
                            xDomain={[domainStart, domainEnd]}
                            yDomain={[0, Math.ceil(maxY * 1.2)]}
                            xScaleType="time"
                            xTitle="Time"
                            yTitle="Event Count"
                            height={300}
                            hideFilter={false}
                            i18nStrings={{
                                xTickFormatter: (d) =>
                                    d instanceof Date
                                        ? d.toLocaleTimeString([], {
                                              hour: "numeric",
                                              minute: "2-digit",
                                          })
                                        : String(d),
                            }}
                        />
                    );
                })()
            ) : (
                <Box textAlign="center" color="text-body-secondary" padding="l">
                    No time-series data available
                </Box>
            )}
        </Container>
    );
}
