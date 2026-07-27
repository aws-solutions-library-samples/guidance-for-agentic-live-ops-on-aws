// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";

import { MessageSources } from "./config";

export default function SourcesPanel({ data }: { data: MessageSources }) {
    const hasAnySources =
        (data.kb_sources?.length ?? 0) > 0 ||
        (data.athena_queries?.length ?? 0) > 0 ||
        (data.data_points?.length ?? 0) > 0 ||
        (data.remediation_sources?.length ?? 0) > 0 ||
        (data.schema_searches?.length ?? 0) > 0 ||
        (data.graph_queries?.length ?? 0) > 0 ||
        (data.entity_links?.length ?? 0) > 0;

    if (!hasAnySources) return null;

    return (
        <div
            style={{
                marginTop: 12,
                padding: "10px 12px",
                background: "rgba(0, 0, 0, 0.04)",
                borderRadius: 8,
            }}
        >
            <ExpandableSection variant="footer" headerText="Data Sources" defaultExpanded={false}>
                <SpaceBetween direction="vertical" size="s">
                    {/* 1. Graph Queries — relationship context first */}
                    {(data.graph_queries?.length ?? 0) > 0 && (
                        <ExpandableSection
                            headerText={`Graph Relationships (${data.graph_queries!.length})`}
                            defaultExpanded={true}
                        >
                            <SpaceBetween direction="vertical" size="s">
                                {data.graph_queries!.map((gq, i) => (
                                    <Container key={i}>
                                        <SpaceBetween direction="vertical" size="xxs">
                                            {gq.tool === "find_join_path" && (
                                                <>
                                                    <Box variant="awsui-key-label">
                                                        Join Path: {gq.source_table} →{" "}
                                                        {gq.target_table} ({gq.hops} hop
                                                        {gq.hops !== 1 ? "s" : ""})
                                                    </Box>
                                                    {gq.path?.map((step, j) => (
                                                        <div
                                                            key={j}
                                                            style={{
                                                                fontSize: "13px",
                                                                fontFamily: "monospace",
                                                                padding: "2px 0",
                                                            }}
                                                        >
                                                            {j + 1}. JOIN ON {step.from} = {step.to}
                                                        </div>
                                                    ))}
                                                </>
                                            )}
                                            {gq.tool === "list_table_relationships" && (
                                                <>
                                                    <Box variant="awsui-key-label">
                                                        Relationships for {gq.table_name} (
                                                        {gq.relationship_count} FK
                                                        {gq.relationship_count !== 1 ? "s" : ""})
                                                    </Box>
                                                    {gq.relationships?.map((rel, j) => (
                                                        <div
                                                            key={j}
                                                            style={{
                                                                fontSize: "13px",
                                                                fontFamily: "monospace",
                                                                padding: "2px 0",
                                                            }}
                                                        >
                                                            {rel.from} → {rel.to}
                                                        </div>
                                                    ))}
                                                </>
                                            )}
                                            {gq.tool === "auto_relationships" && (
                                                <>
                                                    <Box variant="awsui-key-label">
                                                        Auto-discovered: {gq.table_name} (
                                                        {gq.relationship_count} relationship
                                                        {gq.relationship_count !== 1 ? "s" : ""})
                                                    </Box>
                                                    {gq.relationships?.map((rel, j) => (
                                                        <div
                                                            key={j}
                                                            style={{
                                                                fontSize: "13px",
                                                                fontFamily: "monospace",
                                                                padding: "2px 0",
                                                            }}
                                                        >
                                                            {rel.from} → {rel.to}
                                                        </div>
                                                    ))}
                                                </>
                                            )}
                                        </SpaceBetween>
                                    </Container>
                                ))}
                            </SpaceBetween>
                        </ExpandableSection>
                    )}

                    {/* 2. Athena Historical Data Queries */}
                    {(data.athena_queries?.length ?? 0) > 0 && (
                        <ExpandableSection
                            headerText={`Historical Data Queries (${data.athena_queries!.length})`}
                            defaultExpanded={true}
                        >
                            <SpaceBetween direction="vertical" size="s">
                                {data.athena_queries!.map((aq, i) => (
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
                                                    items={aq.sample_rows
                                                        .slice(0, 10)
                                                        .map((row, ri) => {
                                                            const obj: Record<string, string> = {
                                                                _idx: String(ri),
                                                            };
                                                            aq.columns.forEach((col, ci) => {
                                                                obj[col] = row[ci] ?? "";
                                                            });
                                                            return obj;
                                                        })}
                                                    columnDefinitions={aq.columns
                                                        .slice(0, 6)
                                                        .map((col) => ({
                                                            id: col,
                                                            header: col,
                                                            cell: (item: Record<string, string>) =>
                                                                item[col] ?? "",
                                                        }))}
                                                />
                                            )}
                                        </SpaceBetween>
                                    </Container>
                                ))}
                            </SpaceBetween>
                        </ExpandableSection>
                    )}

                    {/* 3. Knowledge Base Sources */}
                    {(data.kb_sources?.length ?? 0) > 0 && (
                        <ExpandableSection
                            headerText={`Knowledge Base Sources (${data.kb_sources!.length})`}
                            defaultExpanded={true}
                        >
                            <SpaceBetween direction="vertical" size="s">
                                {data.kb_sources!.map((src, i) => (
                                    <Container key={i}>
                                        <SpaceBetween direction="vertical" size="xxs">
                                            <Box variant="awsui-key-label">
                                                Source {src.source_index} · Relevance:{" "}
                                                {(src.relevance_score * 100).toFixed(0)}%
                                            </Box>
                                            <div style={{ fontSize: "13px" }}>{src.content}</div>
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
                    )}

                    {/* 4. Schema Search Results */}
                    {(data.schema_searches?.length ?? 0) > 0 && (
                        <ExpandableSection
                            headerText={`Schema Searches (${data.schema_searches!.length})`}
                            defaultExpanded={true}
                        >
                            <SpaceBetween direction="vertical" size="s">
                                {data.schema_searches!.map((ss, i) => (
                                    <Container key={i}>
                                        <SpaceBetween direction="vertical" size="xxs">
                                            <Box variant="awsui-key-label">
                                                Query: &quot;{ss.query}&quot;
                                                {ss.store_filter
                                                    ? ` (store: ${ss.store_filter})`
                                                    : ""}{" "}
                                                · {ss.result_count} results
                                            </Box>
                                            {ss.matches.map((m, j) => (
                                                <div
                                                    key={j}
                                                    style={{
                                                        fontSize: "13px",
                                                        padding: "4px 0",
                                                        borderBottom:
                                                            j < ss.matches.length - 1
                                                                ? "1px solid rgba(0,0,0,0.08)"
                                                                : "none",
                                                    }}
                                                >
                                                    <strong>{m.table_name}</strong>{" "}
                                                    <span style={{ color: "#666" }}>
                                                        ({(m.relevance_score * 100).toFixed(0)}%)
                                                    </span>
                                                    <div
                                                        style={{
                                                            color: "#555",
                                                            fontSize: "12px",
                                                            marginTop: 2,
                                                        }}
                                                    >
                                                        {m.snippet}
                                                    </div>
                                                </div>
                                            ))}
                                        </SpaceBetween>
                                    </Container>
                                ))}
                            </SpaceBetween>
                        </ExpandableSection>
                    )}

                    {/* 5. Live Data Points (DynamoDB) */}
                    {(data.data_points?.length ?? 0) > 0 && (
                        <ExpandableSection headerText="Live Data Points" defaultExpanded={true}>
                            <SpaceBetween direction="vertical" size="s">
                                {data.data_points!.map((dp, i) => (
                                    <Container key={i}>
                                        <SpaceBetween direction="vertical" size="xs">
                                            <Box variant="h4">
                                                {dp.event_type.replace(/_/g, " ")} — last{" "}
                                                {dp.time_range_minutes} min
                                            </Box>
                                            <Box>
                                                Total events:{" "}
                                                <strong>{dp.total_count.toLocaleString()}</strong>
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
                                                                        ? (
                                                                              (count /
                                                                                  dp.total_count) *
                                                                              100
                                                                          ).toFixed(1)
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
                                                                cell: (item) =>
                                                                    item.count.toLocaleString(),
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
                                                                        ? (
                                                                              (count /
                                                                                  dp.total_count) *
                                                                              100
                                                                          ).toFixed(1)
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
                                                                cell: (item) =>
                                                                    item.count.toLocaleString(),
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
                    )}

                    {/* 6. Remediation Sources */}
                    {(data.remediation_sources?.length ?? 0) > 0 && (
                        <ExpandableSection
                            headerText={`Remediation Sources (${data.remediation_sources!.length})`}
                            defaultExpanded={true}
                        >
                            <SpaceBetween direction="vertical" size="s">
                                {data.remediation_sources!.map((src, i) => (
                                    <Container key={i}>
                                        <SpaceBetween direction="vertical" size="xxs">
                                            <Box variant="awsui-key-label">
                                                Remediation {src.source_index} · Relevance:{" "}
                                                {(src.relevance_score * 100).toFixed(0)}%
                                            </Box>
                                            <div
                                                style={{ whiteSpace: "pre-wrap", fontSize: "13px" }}
                                            >
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
                    )}

                    {/* 7. Entity Links */}
                    {(data.entity_links?.length ?? 0) > 0 && (
                        <ExpandableSection
                            headerText={`Entity Links (${data.entity_links!.length})`}
                            defaultExpanded={true}
                        >
                            <SpaceBetween direction="vertical" size="s">
                                {data.entity_links!.map((el, i) => (
                                    <Container key={i}>
                                        <SpaceBetween direction="vertical" size="xxs">
                                            <Box variant="awsui-key-label">
                                                {el.matched_entity} ({el.entity_type}) · Confidence:{" "}
                                                {(el.confidence * 100).toFixed(0)}%
                                            </Box>
                                            <div style={{ fontSize: "13px" }}>
                                                Document: <strong>{el.document_name}</strong>
                                            </div>
                                            {el.source_path && (
                                                <Box variant="small" color="text-body-secondary">
                                                    {el.source_path}
                                                </Box>
                                            )}
                                        </SpaceBetween>
                                    </Container>
                                ))}
                            </SpaceBetween>
                        </ExpandableSection>
                    )}
                </SpaceBetween>
            </ExpandableSection>
        </div>
    );
}
