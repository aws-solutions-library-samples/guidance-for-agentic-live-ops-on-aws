// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import Modal from "@cloudscape-design/components/modal";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";

interface AgentInfo {
    name: string;
    icon: string;
    tagline: string;
    description: string;
    examples: string[];
}

const AGENTS: AgentInfo[] = [
    {
        name: "Performance Metrics Agent",
        icon: "📊",
        tagline: "KPIs, revenue, and monetization analysis",
        description:
            "Analyzes game performance indicators including DAU/MAU, session length, retention rates, ARPU, and revenue trends. Best for questions about how the game is performing financially and operationally.",
        examples: [
            "What is the average revenue per paying user this month?",
            "How has D7 retention changed over the last 30 days?",
            "Which platform generates the most revenue?",
        ],
    },
    {
        name: "Player Segmentation Agent",
        icon: "🎯",
        tagline: "Cohort analysis and player behavior clustering",
        description:
            "Groups players into meaningful segments (whales, dolphins, minnows, churned, at-risk) and analyzes behavioral patterns within each cohort. Use this for understanding who your players are.",
        examples: [
            "How many players are in each spending segment?",
            "What is the average combat power for whale players?",
            "Which segments have the highest churn rate?",
        ],
    },
    {
        name: "Player Targeting Agent",
        icon: "🔍",
        tagline: "Character targeting and engagement patterns",
        description:
            "Identifies specific player audiences for campaigns, promotions, or interventions based on behavior, preferences, and engagement signals. Useful for finding the right players to target.",
        examples: [
            "Which players haven't logged in for 7 days but were previously active?",
            "Find players who own legendary heroes but haven't made a purchase recently.",
            "Which players are most likely to respond to a guild recruitment campaign?",
        ],
    },
    {
        name: "Trend Analysis Agent",
        icon: "📈",
        tagline: "Behavioral trends and pattern detection over time",
        description:
            "Detects trends, seasonality, and shifts in player behavior over time. Compares periods, identifies inflection points, and surfaces emerging patterns before they become problems.",
        examples: [
            "How has arena battle participation trended over the last 90 days?",
            "Are session lengths getting shorter or longer over time?",
            "What day of the week sees the highest purchase volume?",
        ],
    },
    {
        name: "Creative Optimization Agent",
        icon: "🎨",
        tagline: "Campaign creative and content performance",
        description:
            "Evaluates the effectiveness of marketing campaigns, in-game events, and creative content. Helps identify what messaging, channels, and formats drive the best results.",
        examples: [
            "Which campaigns have the highest conversion rate?",
            "What acquisition channels deliver the best lifetime value?",
            "How did the summer event perform compared to the spring event?",
        ],
    },
    {
        name: "Acquisition Optimization Agent",
        icon: "📣",
        tagline: "UA channel ROI, CPI, and LTV analysis",
        description:
            "Analyzes user acquisition performance across channels — cost per install, lifetime value, D1/D7/D30 retention by source, and campaign ROI. Use this to optimize UA spend.",
        examples: [
            "What is the D30 retention rate by acquisition channel?",
            "Which channel has the lowest cost per install?",
            "Compare lifetime value across paid vs organic installs.",
        ],
    },
    {
        name: "Fact Checking Agent",
        icon: "✅",
        tagline: "Validates claims against actual data",
        description:
            "Cross-references analytical claims against raw data to verify accuracy. Useful when you want to confirm a finding, check a hypothesis, or validate a number before acting on it.",
        examples: [
            "Is it true that iOS players spend more than Android players?",
            "Verify that guild members have higher retention than non-guild players.",
            "Confirm the reported 15% drop in purchases last week.",
        ],
    },
    {
        name: "Incident Response Agent",
        icon: "🚨",
        tagline: "Historical incident analysis with live anomaly context",
        description:
            "Investigates past incidents, outages, and anomalies. Correlates historical incident records with live telemetry to understand root causes, affected player counts, and resolution patterns.",
        examples: [
            "Which incidents had the most affected players?",
            "How long did it take to resolve the last purchase failure incident?",
            "Are there any recurring incident patterns on weekends?",
        ],
    },
];

interface AgentsModalProps {
    visible: boolean;
    onDismiss: () => void;
}

export default function AgentsModal({ visible, onDismiss }: AgentsModalProps) {
    return (
        <Modal
            visible={visible}
            onDismiss={onDismiss}
            header="Available Agents"
            size="large"
            footer={
                <Box float="right">
                    <Button variant="primary" onClick={onDismiss}>
                        Close
                    </Button>
                </Box>
            }
        >
            <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }}>
                <SpaceBetween direction="vertical" size="l">
                    {AGENTS.map((agent) => (
                        <div
                            key={agent.name}
                            style={{
                                borderLeft: "3px solid #0972d3",
                                paddingLeft: 16,
                                paddingTop: 4,
                                paddingBottom: 4,
                            }}
                        >
                            <SpaceBetween direction="vertical" size="xxs">
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ fontSize: 20 }}>{agent.icon}</span>
                                    <Box variant="h3" fontSize="heading-s">
                                        {agent.name}
                                    </Box>
                                </div>
                                <Box color="text-body-secondary" fontSize="body-s">
                                    {agent.tagline}
                                </Box>
                                <Box fontSize="body-m">{agent.description}</Box>
                                <Box color="text-body-secondary" fontSize="body-s">
                                    <strong>Example questions:</strong>
                                    <ul style={{ margin: "4px 0 0 0", paddingLeft: 18 }}>
                                        {agent.examples.map((ex) => (
                                            <li key={ex} style={{ marginBottom: 2 }}>
                                                {ex}
                                            </li>
                                        ))}
                                    </ul>
                                </Box>
                            </SpaceBetween>
                        </div>
                    ))}
                </SpaceBetween>
            </div>
        </Modal>
    );
}
