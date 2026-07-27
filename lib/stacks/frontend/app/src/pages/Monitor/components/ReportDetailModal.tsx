// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
    Box,
    Button,
    ColumnLayout,
    Container,
    ExpandableSection,
    Modal,
    SpaceBetween,
    Table,
} from "@cloudscape-design/components";
import MarkdownRenderer from "../../../components/Chat/markdown-renderer";
import { Report } from "../../../services/monitor-service";
import { downloadReport } from "../utils/downloadReport";

/** Convert markdown headings to bold text so source snippets don't render as giant headings. */
const flattenMarkdownHeadings = (text: string) =>
    text.replace(/(?:^|\n)(#{1,6})\s+(.+)/g, "\n\n**$2**\n\n");

interface ReportDetailModalProps {
    report: Report | null;
    onDismiss: () => void;
    onSendToChat?: (prompt: string, report?: Report) => void;
}

export default function ReportDetailModal({
    report,
    onDismiss,
    onSendToChat,
}: ReportDetailModalProps) {
    if (!report) return null;

    return (
        <Modal
            visible={!!report}
            onDismiss={onDismiss}
            header={`Report: ${report.event_type.replace(/_/g, " ")}`}
            size="large"
            footer={
                <Box float="right">
                    <SpaceBetween direction="horizontal" size="xs">
                        <Button iconName="download" onClick={() => downloadReport(report)}>
                            Download PDF
                        </Button>
                        {onSendToChat && (
                            <Button
                                iconName="contact"
                                onClick={() => {
                                    const ctx = (() => {
                                        try {
                                            return JSON.parse(report.trigger_context || "{}");
                                        } catch {
                                            return {};
                                        }
                                    })();
                                    const prompt = `I have a monitoring report for **${report.event_type.replace(/_/g, " ")}** generated at ${new Date(report.created_at).toLocaleString()}.\n\n**Trigger:** ${ctx.current_count ?? report.current_count ?? "?"} events (threshold: ${ctx.threshold ?? report.threshold ?? "?"})\n\n**Analysis:**\n${report.analysis}\n\nPlease help me dig deeper into this. What additional data should I look at, and what actions would you recommend?`;
                                    onSendToChat(prompt, report);
                                    onDismiss();
                                }}
                            >
                                Ask in Chat
                            </Button>
                        )}
                        <Button variant="primary" onClick={onDismiss}>
                            Close
                        </Button>
                    </SpaceBetween>
                </Box>
            }
        >
            <SpaceBetween direction="vertical" size="m">
                <Box variant="small" color="text-body-secondary">
                    Rule: {report.rule_id} · Generated:{" "}
                    {new Date(report.created_at).toLocaleString()}
                </Box>

                {/* Trigger Context */}
                <TriggerContext report={report} />

                <MarkdownRenderer content={report.analysis} />

                <DataPointsSection report={report} />
                <AthenaQueriesSection report={report} />
                <KbSourcesSection report={report} />
                <RemediationSourcesSection report={report} />
            </SpaceBetween>
        </Modal>
    );
}

function TriggerContext({ report }: { report: Report }) {
    try {
        const ctx = JSON.parse(report.trigger_context || "{}");
        return (
            <Container>
                <ColumnLayout columns={3} variant="text-grid">
                    <div>
                        <Box variant="awsui-key-label">Event Type</Box>
                        <Box>{(ctx.event_type || report.event_type).replace(/_/g, " ")}</Box>
                    </div>
                    <div>
                        <Box variant="awsui-key-label">Count at Trigger</Box>
                        <Box>
                            {(ctx.current_count ?? report.current_count ?? "—").toLocaleString()}
                        </Box>
                    </div>
                    <div>
                        <Box variant="awsui-key-label">Threshold</Box>
                        <Box>{(ctx.threshold ?? report.threshold ?? "—").toLocaleString()}</Box>
                    </div>
                    {ctx.description && (
                        <div style={{ gridColumn: "1 / -1" }}>
                            <Box variant="awsui-key-label">Rule Description</Box>
                            <Box>{ctx.description}</Box>
                        </div>
                    )}
                    <div>
                        <Box variant="awsui-key-label">Data Window</Box>
                        <Box>{ctx.window_minutes ? `${ctx.window_minutes} min` : "2 min"}</Box>
                    </div>
                    {ctx.analyzed_at && (
                        <div>
                            <Box variant="awsui-key-label">Analyzed At</Box>
                            <Box>{new Date(ctx.analyzed_at).toLocaleString()}</Box>
                        </div>
                    )}
                </ColumnLayout>
            </Container>
        );
    } catch {
        return null;
    }
}

function DataPointsSection({ report }: { report: Report }) {
    if ((report.artifacts?.data_points?.length ?? 0) === 0) return null;

    return (
        <ExpandableSection headerText="📊 Live Data Points" defaultExpanded={true}>
            <SpaceBetween direction="vertical" size="s">
                {report.artifacts!.data_points.map((dp, i) => (
                    <Container key={i}>
                        <SpaceBetween direction="vertical" size="xs">
                            <Box variant="h4">
                                {dp.event_type.replace(/_/g, " ")} — last {dp.time_range_minutes}{" "}
                                min
                            </Box>
                            <Box>
                                Total events: <strong>{dp.total_count.toLocaleString()}</strong>
                            </Box>
                            {Object.keys(dp.platforms).length > 0 && (
                                <div>
                                    <Box variant="awsui-key-label">By Platform</Box>
                                    <Table
                                        variant="embedded"
                                        sortingDisabled
                                        items={Object.entries(dp.platforms)
                                            .sort(([, a], [, b]) => b - a)
                                            .map(([name, count]) => ({
                                                name,
                                                count,
                                                pct:
                                                    dp.total_count > 0
                                                        ? ((count / dp.total_count) * 100).toFixed(
                                                              1
                                                          )
                                                        : "0",
                                            }))}
                                        columnDefinitions={[
                                            {
                                                id: "name",
                                                header: "Platform",
                                                cell: (item) => item.name,
                                            },
                                            {
                                                id: "count",
                                                header: "Events",
                                                cell: (item) => item.count.toLocaleString(),
                                            },
                                            {
                                                id: "pct",
                                                header: "%",
                                                cell: (item) => `${item.pct}%`,
                                            },
                                        ]}
                                    />
                                </div>
                            )}
                            {Object.keys(dp.regions).length > 0 && (
                                <div>
                                    <Box variant="awsui-key-label">By Region</Box>
                                    <Table
                                        variant="embedded"
                                        sortingDisabled
                                        items={Object.entries(dp.regions)
                                            .sort(([, a], [, b]) => b - a)
                                            .map(([name, count]) => ({
                                                name,
                                                count,
                                                pct:
                                                    dp.total_count > 0
                                                        ? ((count / dp.total_count) * 100).toFixed(
                                                              1
                                                          )
                                                        : "0",
                                            }))}
                                        columnDefinitions={[
                                            {
                                                id: "name",
                                                header: "Region",
                                                cell: (item) => item.name,
                                            },
                                            {
                                                id: "count",
                                                header: "Events",
                                                cell: (item) => item.count.toLocaleString(),
                                            },
                                            {
                                                id: "pct",
                                                header: "%",
                                                cell: (item) => `${item.pct}%`,
                                            },
                                        ]}
                                    />
                                </div>
                            )}
                        </SpaceBetween>
                    </Container>
                ))}
            </SpaceBetween>
        </ExpandableSection>
    );
}

function AthenaQueriesSection({ report }: { report: Report }) {
    if ((report.artifacts?.athena_queries?.length ?? 0) === 0) return null;

    return (
        <ExpandableSection
            headerText={`🗄️ Historical Data Queries (${report.artifacts!.athena_queries.length})`}
            defaultExpanded={true}
        >
            <SpaceBetween direction="vertical" size="s">
                {report.artifacts!.athena_queries.map((aq, i) => (
                    <Container key={i}>
                        <SpaceBetween direction="vertical" size="xs">
                            <Box variant="awsui-key-label">SQL Query</Box>
                            <Box>
                                <code
                                    style={{
                                        fontSize: "12px",
                                        whiteSpace: "pre-wrap",
                                        wordBreak: "break-all",
                                        background: "rgba(0,0,0,0.05)",
                                        padding: "6px 8px",
                                        borderRadius: 4,
                                        display: "block",
                                    }}
                                >
                                    {aq.sql}
                                </code>
                            </Box>
                            <Box>
                                Rows returned: <strong>{aq.row_count}</strong>
                            </Box>
                            {aq.columns.length > 0 && aq.sample_rows.length > 0 && (
                                <Table
                                    variant="embedded"
                                    sortingDisabled
                                    items={aq.sample_rows.slice(0, 10).map((row, ri) => {
                                        const obj: Record<string, string> = { _idx: String(ri) };
                                        aq.columns.forEach((col, ci) => {
                                            obj[col] = row[ci] ?? "";
                                        });
                                        return obj;
                                    })}
                                    columnDefinitions={aq.columns.slice(0, 6).map((col) => ({
                                        id: col,
                                        header: col,
                                        cell: (item: Record<string, string>) => item[col] ?? "",
                                    }))}
                                />
                            )}
                        </SpaceBetween>
                    </Container>
                ))}
            </SpaceBetween>
        </ExpandableSection>
    );
}

function KbSourcesSection({ report }: { report: Report }) {
    if ((report.artifacts?.kb_sources?.length ?? 0) === 0) return null;

    return (
        <ExpandableSection
            headerText={`📚 Knowledge Base Sources (${report.artifacts!.kb_sources.length})`}
            defaultExpanded={true}
        >
            <SpaceBetween direction="vertical" size="s">
                {report.artifacts!.kb_sources.map((src, i) => (
                    <Container key={i}>
                        <SpaceBetween direction="vertical" size="xxs">
                            <Box variant="awsui-key-label">
                                Source {src.source_index} · Relevance:{" "}
                                {(src.relevance_score * 100).toFixed(0)}%
                            </Box>
                            <div style={{ fontSize: "13px" }}>
                                <MarkdownRenderer content={flattenMarkdownHeadings(src.content)} />
                            </div>
                            {src.source_uri && (
                                <Box variant="small" color="text-body-secondary">
                                    {src.source_uri}
                                </Box>
                            )}
                        </SpaceBetween>
                    </Container>
                ))}
            </SpaceBetween>
        </ExpandableSection>
    );
}

function RemediationSourcesSection({ report }: { report: Report }) {
    if ((report.artifacts?.remediation_sources?.length ?? 0) === 0) return null;

    return (
        <ExpandableSection
            headerText={`🛠️ Remediation Sources (${report.artifacts!.remediation_sources.length})`}
            defaultExpanded={true}
        >
            <SpaceBetween direction="vertical" size="s">
                {report.artifacts!.remediation_sources.map((src, i) => (
                    <Container key={i}>
                        <SpaceBetween direction="vertical" size="xxs">
                            <Box variant="awsui-key-label">
                                Remediation {src.source_index} · Relevance:{" "}
                                {(src.relevance_score * 100).toFixed(0)}%
                            </Box>
                            <div style={{ whiteSpace: "pre-wrap", fontSize: "13px" }}>
                                {src.content}
                            </div>
                            {src.source_uri && (
                                <Box variant="small" color="text-body-secondary">
                                    {src.source_uri}
                                </Box>
                            )}
                        </SpaceBetween>
                    </Container>
                ))}
            </SpaceBetween>
        </ExpandableSection>
    );
}
