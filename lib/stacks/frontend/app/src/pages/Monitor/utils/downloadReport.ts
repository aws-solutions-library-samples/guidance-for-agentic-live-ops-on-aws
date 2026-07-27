// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Report } from "../../../services/monitor-service";

export function downloadReport(report: Report) {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 14;
    let y = 20;

    // Title
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text(`Report: ${report.event_type.replace(/_/g, " ")}`, margin, y);
    y += 10;

    // Meta
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100);
    doc.text(
        `Rule: ${report.rule_id}  |  Generated: ${new Date(report.created_at).toLocaleString()}`,
        margin,
        y
    );
    y += 10;

    // Trigger context
    try {
        const ctx = JSON.parse(report.trigger_context || "{}");
        doc.setTextColor(0);
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.text("Trigger Context", margin, y);
        y += 6;
        autoTable(doc, {
            startY: y,
            margin: { left: margin, right: margin },
            head: [["Event Type", "Count at Trigger", "Threshold", "Data Window", "Description"]],
            body: [
                [
                    (ctx.event_type || report.event_type).replace(/_/g, " "),
                    String(ctx.current_count ?? report.current_count ?? "—"),
                    String(ctx.threshold ?? report.threshold ?? "—"),
                    ctx.window_minutes ? `${ctx.window_minutes} min` : "2 min",
                    ctx.description || "—",
                ],
            ],
            styles: { fontSize: 9 },
            headStyles: { fillColor: [35, 47, 62] },
        });
        y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
    } catch {
        /* skip */
    }

    // Analysis
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Analysis", margin, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const analysisLines = doc.splitTextToSize(report.analysis, pageWidth - margin * 2);
    doc.text(analysisLines, margin, y);
    y += analysisLines.length * 4.5 + 8;

    // Data Points
    if ((report.artifacts?.data_points?.length ?? 0) > 0) {
        for (const dp of report.artifacts!.data_points) {
            if (y > 250) {
                doc.addPage();
                y = 20;
            }
            doc.setFontSize(11);
            doc.setFont("helvetica", "bold");
            doc.text(
                `Live Data: ${dp.event_type.replace(/_/g, " ")} (last ${dp.time_range_minutes} min) — ${dp.total_count.toLocaleString()} events`,
                margin,
                y
            );
            y += 6;

            const platformRows = Object.entries(dp.platforms)
                .sort(([, a], [, b]) => b - a)
                .map(([name, count]) => [
                    name,
                    count.toLocaleString(),
                    `${dp.total_count > 0 ? ((count / dp.total_count) * 100).toFixed(1) : 0}%`,
                ]);
            const regionRows = Object.entries(dp.regions)
                .sort(([, a], [, b]) => b - a)
                .map(([name, count]) => [
                    name,
                    count.toLocaleString(),
                    `${dp.total_count > 0 ? ((count / dp.total_count) * 100).toFixed(1) : 0}%`,
                ]);

            if (platformRows.length > 0) {
                autoTable(doc, {
                    startY: y,
                    margin: { left: margin, right: margin },
                    head: [["Platform", "Events", "%"]],
                    body: platformRows,
                    styles: { fontSize: 9 },
                    headStyles: { fillColor: [35, 47, 62] },
                });
                y =
                    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY +
                    6;
            }
            if (regionRows.length > 0) {
                autoTable(doc, {
                    startY: y,
                    margin: { left: margin, right: margin },
                    head: [["Region", "Events", "%"]],
                    body: regionRows,
                    styles: { fontSize: 9 },
                    headStyles: { fillColor: [35, 47, 62] },
                });
                y =
                    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY +
                    10;
            }
        }
    }

    // Athena Historical Data Queries
    if ((report.artifacts?.athena_queries?.length ?? 0) > 0) {
        if (y > 240) {
            doc.addPage();
            y = 20;
        }
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.text(`Historical Data Queries (${report.artifacts!.athena_queries.length})`, margin, y);
        y += 6;
        for (const aq of report.artifacts!.athena_queries) {
            if (y > 250) {
                doc.addPage();
                y = 20;
            }
            doc.setFontSize(8);
            doc.setFont("courier", "normal");
            const sqlLines = doc.splitTextToSize(aq.sql, pageWidth - margin * 2);
            doc.text(sqlLines, margin, y);
            y += sqlLines.length * 3.5 + 4;

            doc.setFont("helvetica", "normal");
            doc.setFontSize(9);
            doc.text(`Rows returned: ${aq.row_count}`, margin, y);
            y += 5;

            if (aq.columns.length > 0 && aq.sample_rows.length > 0) {
                const cols = aq.columns.slice(0, 6);
                const rows = aq.sample_rows
                    .slice(0, 10)
                    .map((row) => cols.map((_, ci) => row[ci] ?? ""));
                autoTable(doc, {
                    startY: y,
                    margin: { left: margin, right: margin },
                    head: [cols],
                    body: rows,
                    styles: { fontSize: 7 },
                    headStyles: { fillColor: [35, 47, 62] },
                });
                y =
                    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY +
                    10;
            }
        }
    }

    // KB Sources
    if ((report.artifacts?.kb_sources?.length ?? 0) > 0) {
        if (y > 240) {
            doc.addPage();
            y = 20;
        }
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.text(`Knowledge Base Sources (${report.artifacts!.kb_sources.length})`, margin, y);
        y += 6;
        for (const src of report.artifacts!.kb_sources) {
            if (y > 250) {
                doc.addPage();
                y = 20;
            }
            doc.setFontSize(9);
            doc.setFont("helvetica", "bold");
            doc.text(
                `Source ${src.source_index} — Relevance: ${(src.relevance_score * 100).toFixed(0)}%`,
                margin,
                y
            );
            y += 5;
            doc.setFont("helvetica", "normal");
            const srcLines = doc.splitTextToSize(src.content, pageWidth - margin * 2);
            doc.text(srcLines, margin, y);
            y += srcLines.length * 4 + 8;
        }
    }

    // Remediation Sources
    if ((report.artifacts?.remediation_sources?.length ?? 0) > 0) {
        if (y > 240) {
            doc.addPage();
            y = 20;
        }
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.text(
            `Remediation Sources (${report.artifacts!.remediation_sources.length})`,
            margin,
            y
        );
        y += 6;
        for (const src of report.artifacts!.remediation_sources) {
            if (y > 250) {
                doc.addPage();
                y = 20;
            }
            doc.setFontSize(9);
            doc.setFont("helvetica", "bold");
            doc.text(
                `Remediation ${src.source_index} — Relevance: ${(src.relevance_score * 100).toFixed(0)}%`,
                margin,
                y
            );
            y += 5;
            doc.setFont("helvetica", "normal");
            const srcLines = doc.splitTextToSize(src.content, pageWidth - margin * 2);
            doc.text(srcLines, margin, y);
            y += srcLines.length * 4 + 8;
        }
    }

    doc.save(`report-${report.event_type}-${report.created_at.replace(/[:.]/g, "-")}.pdf`);
}
