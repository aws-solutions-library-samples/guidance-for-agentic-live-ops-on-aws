// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Box from "@cloudscape-design/components/box";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import { MessagePart } from "./config";

interface StepItem {
    id: string;
    type:
        | "memory"
        | "knowledgebase"
        | "schema"
        | "graph"
        | "agent"
        | "error"
        | "thinking"
        | "analysis";
    label: string;
    status: "in-progress" | "completed" | "error";
    detail?: string;
}

const ICONS: Record<StepItem["type"], string> = {
    memory: "🧠",
    knowledgebase: "📚",
    schema: "🔍",
    graph: "🔗",
    agent: "🤖",
    error: "❌",
    thinking: "💭",
    analysis: "📊",
};

function StepCard({ step }: { step: StepItem }) {
    const icon = ICONS[step.type] || "⚙️";
    const hasDetail = step.detail && step.detail.trim().length > 0;

    const label = (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <span>{icon}</span>
            <span>{step.label}</span>
            {step.status === "in-progress" && <Spinner size="normal" />}
            {step.status === "completed" && <StatusIndicator type="success">{""}</StatusIndicator>}
            {step.status === "error" && <StatusIndicator type="error">{""}</StatusIndicator>}
        </span>
    );

    if (!hasDetail) {
        return <div style={{ padding: "4px 0" }}>{label}</div>;
    }

    return (
        <ExpandableSection headerText={label} variant="footer" defaultExpanded={false}>
            <Box fontSize="body-s" padding={{ top: "xxs" }}>
                <pre
                    style={{
                        margin: 0,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontSize: 12,
                        overflow: "auto",
                        background: "#f2f3f3",
                        padding: 8,
                        borderRadius: 4,
                    }}
                >
                    {step.detail}
                </pre>
            </Box>
        </ExpandableSection>
    );
}

export default function ActivityFeed({ parts }: { parts: MessagePart[] }) {
    const steps = parts
        .filter(
            (p): p is Extract<MessagePart, { type: "agent-step" | "analysis" | "memory" }> =>
                p.type === "agent-step" || p.type === "analysis" || p.type === "memory"
        )
        .map((p) => {
            if (p.type === "agent-step") {
                return {
                    id: p.id,
                    type: "agent" as const,
                    label: p.status === "in-progress" ? `${p.agentName} working...` : p.agentName,
                    status: p.status,
                    detail: p.detail,
                };
            } else if (p.type === "analysis") {
                return {
                    id: p.id,
                    type: "analysis" as const,
                    label: p.label,
                    status: "completed" as const,
                    detail: undefined,
                };
            } else {
                // memory
                return {
                    id: p.id,
                    type: "memory" as const,
                    label: p.label,
                    status: "completed" as const,
                    detail: undefined,
                };
            }
        });

    if (!steps || steps.length === 0) return null;

    return (
        <div style={{ borderLeft: "2px solid #0972d3", paddingLeft: 12, marginBottom: 12 }}>
            {steps.map((step) => (
                <StepCard key={step.id} step={step} />
            ))}
        </div>
    );
}
