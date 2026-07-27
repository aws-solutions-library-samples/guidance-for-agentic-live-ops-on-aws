// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Button, Container, Header, StatusIndicator, Table } from "@cloudscape-design/components";
import { Report } from "../../../services/monitor-service";
import { PendingReport } from "../types";

interface ReportsTableProps {
    reports: Report[];
    pendingReports: PendingReport[];
    getSeverity: (eventType: string) => "success" | "warning" | "error";
    onSelectReport: (report: Report) => void;
}

export default function ReportsTable({
    reports,
    pendingReports,
    getSeverity,
    onSelectReport,
}: ReportsTableProps) {
    return (
        <Container header={<Header variant="h3">All Reports ({reports.length})</Header>}>
            <Table
                items={[
                    ...pendingReports.map((p) => ({
                        report_id: `pending-${p.event_type}`,
                        created_at: p.requested_at,
                        rule_id: "pending",
                        event_type: p.event_type,
                        analysis: "Generating report…",
                        trigger_context: "",
                        severity: p.severity,
                    })),
                    ...[...reports].sort((a, b) => b.created_at.localeCompare(a.created_at)),
                ]}
                columnDefinitions={[
                    {
                        id: "actions",
                        header: "",
                        cell: (item: Report) => {
                            const sev = item.severity || getSeverity(item.event_type);
                            const color =
                                sev === "error"
                                    ? "#d13737"
                                    : sev === "warning"
                                      ? "#ff9900"
                                      : "#1d8102";
                            return (
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 4,
                                    }}
                                >
                                    <div
                                        style={{
                                            width: 4,
                                            height: 24,
                                            borderRadius: 2,
                                            background: color,
                                            flexShrink: 0,
                                        }}
                                    />
                                    <Button
                                        variant="icon"
                                        iconName="file"
                                        onClick={() => onSelectReport(item)}
                                        ariaLabel="View report"
                                    />
                                </div>
                            );
                        },
                        width: 60,
                    },
                    {
                        id: "created_at",
                        header: "Time",
                        cell: (item: Report) => new Date(item.created_at).toLocaleString(),
                        sortingField: "created_at",
                        width: 180,
                    },
                    {
                        id: "event_type",
                        header: "Event Type",
                        cell: (item: Report) => (
                            <StatusIndicator type={item.severity || getSeverity(item.event_type)}>
                                {item.event_type.replace(/_/g, " ")}
                            </StatusIndicator>
                        ),
                        width: 160,
                    },
                    {
                        id: "rule_id",
                        header: "Rule",
                        cell: (item: Report) =>
                            item.rule_id === "pending" ? (
                                <StatusIndicator type="in-progress">Generating…</StatusIndicator>
                            ) : (
                                item.rule_id
                            ),
                        width: 160,
                    },
                    {
                        id: "analysis",
                        header: "Analysis Preview",
                        cell: (item: Report) =>
                            item.analysis.length > 150
                                ? `${item.analysis.slice(0, 150)}…`
                                : item.analysis,
                    },
                ]}
                sortingDisabled
                variant="embedded"
                empty="No reports generated yet. Send events to trigger pattern detection."
            />
        </Container>
    );
}
