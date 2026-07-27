// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React from "react";
import ChatBubble from "@cloudscape-design/chat-components/chat-bubble";

import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import LiveRegion from "@cloudscape-design/components/live-region";
import SpaceBetween from "@cloudscape-design/components/space-between";

import FeedbackDialog from "./additional-info/feedback-dialog";
import {
    ChatBubbleAvatar,
    CodeViewActions,
    FeedbackActionsWithDownload,
} from "./common-components";
import { messageHasCharts, messageHasCSV, messageHasTables, MessageData } from "./download-utils";

import { createAuthors, Message, supportPromptItems } from "./config";
import SourcesPanel from "./sources-panel";
import { useUser } from "../../contexts/UserContext";
import ChartComponent from "./chart-component";
import { parseMultipleChartData } from "./chart-parser";
import { parseMultipleCSVData, CSVData } from "./csv-parser";
import CSVTable from "./csv-table";
import { parseMultipleTableData, TableData } from "./table-parser";
import TableComponent from "./table-component";
import MarkdownRenderer from "./markdown-renderer";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import { MessagePart } from "./config";

import "../../common/styles/chat.scss";

function MessageParts({
    parts,
    processContent,
}: {
    parts: MessagePart[];
    processContent: (content: React.ReactNode) => React.ReactNode;
}) {
    // Sort parts into the desired display order:
    // 1. Memory steps
    // 2. Analysis steps
    // 3. Sub-agent steps (not orchestrator)
    // 4. Orchestrator step (always last agent, just above output)
    // 5. Text content (the actual response)
    // 6. Sources (data provenance)
    const getSortKey = (part: MessagePart): number => {
        if (part.type === "memory") return 0;
        if (part.type === "analysis") return 1;
        if (part.type === "agent-step") {
            const isOrchestrator = part.agentName?.toLowerCase().includes("orchestrator");
            return isOrchestrator ? 3 : 2;
        }
        if (part.type === "text") return 4;
        if (part.type === "sources") return 5;
        return 99;
    };

    const sorted = [...parts].sort((a, b) => getSortKey(a) - getSortKey(b));

    return (
        <SpaceBetween size="xs">
            {sorted.map((part) => {
                switch (part.type) {
                    case "agent-step": {
                        const headerLabel = (
                            <span
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    fontSize: 13,
                                }}
                            >
                                <span>🤖</span>
                                <span>{part.agentName}</span>
                                {part.status === "in-progress" && <Spinner size="normal" />}
                                {part.status === "completed" && (
                                    <StatusIndicator type="success">{""}</StatusIndicator>
                                )}
                                {part.status === "error" && (
                                    <StatusIndicator type="error">{""}</StatusIndicator>
                                )}
                            </span>
                        );

                        const hasQuery = part.query && part.query.trim().length > 0;
                        const hasDetail = part.detail && part.detail.trim().length > 0;

                        if (!hasQuery && !hasDetail) {
                            return (
                                <div key={part.id} style={{ padding: "4px 0" }}>
                                    {headerLabel}
                                </div>
                            );
                        }

                        return (
                            <ExpandableSection
                                key={part.id}
                                headerText={headerLabel}
                                variant="footer"
                                defaultExpanded={false}
                            >
                                <SpaceBetween size="xs">
                                    {hasQuery && (
                                        <div>
                                            <Box
                                                fontSize="body-s"
                                                color="text-body-secondary"
                                                fontWeight="bold"
                                                padding={{ bottom: "xxs" }}
                                            >
                                                Prompt
                                            </Box>
                                            <pre
                                                style={{
                                                    margin: 0,
                                                    whiteSpace: "pre-wrap",
                                                    wordBreak: "break-word",
                                                    fontSize: 12,
                                                    overflow: "auto",
                                                    background: "#e8f4fd",
                                                    padding: 8,
                                                    borderRadius: 4,
                                                    borderLeft: "3px solid #0972d3",
                                                }}
                                            >
                                                {part.query}
                                            </pre>
                                        </div>
                                    )}
                                    {hasDetail && (
                                        <div>
                                            <Box
                                                fontSize="body-s"
                                                color="text-body-secondary"
                                                fontWeight="bold"
                                                padding={{ bottom: "xxs" }}
                                            >
                                                Response
                                            </Box>
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
                                                    borderLeft: "3px solid #037f0c",
                                                }}
                                            >
                                                {part.detail}
                                            </pre>
                                        </div>
                                    )}
                                </SpaceBetween>
                            </ExpandableSection>
                        );
                    }
                    case "analysis":
                        return (
                            <div key={part.id} style={{ padding: "4px 0" }}>
                                <span
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 6,
                                        fontSize: 13,
                                    }}
                                >
                                    <span>📊</span>
                                    <span>{part.label}</span>
                                    <StatusIndicator type="success">{""}</StatusIndicator>
                                </span>
                            </div>
                        );
                    case "memory":
                        return (
                            <div key={part.id} style={{ padding: "4px 0" }}>
                                <span
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 6,
                                        fontSize: 13,
                                    }}
                                >
                                    <span>🧠</span>
                                    <span>{part.label}</span>
                                    <StatusIndicator type="success">{""}</StatusIndicator>
                                </span>
                            </div>
                        );
                    case "text":
                        return <div key={part.id}>{processContent(part.content)}</div>;
                    case "sources":
                        return <SourcesPanel key={part.id} data={part.data} />;
                    default:
                        return null;
                }
            })}
        </SpaceBetween>
    );
}

export default function Messages({
    messages = [],
    setShowFeedbackDialog,
    addMessage,
}: {
    messages: Array<Message>;
    setShowFeedbackDialog: (index: number, show: boolean) => void;
    addMessage: (index: number, message: Message) => void;
}) {
    const messageRefs = React.useRef<(HTMLDivElement | null)[]>([]);
    const latestMessage: Message = messages[messages.length - 1];
    const { userInfo } = useUser();

    const promptText = supportPromptItems.map((item) => item.text);

    // Create AUTHORS with current user info
    const AUTHORS = createAuthors(
        userInfo ? { name: userInfo.name, initials: userInfo.initials } : undefined
    );

    // Function to process message content and extract charts, CSV data, and table data
    const processMessageContent = (content: React.ReactNode) => {
        // Only process string content that might contain chart, CSV, or table data
        if (typeof content === "string") {
            // First parse charts
            const { chartDataList, cleanedContent: contentAfterCharts } =
                parseMultipleChartData(content);

            // Then parse CSV data from the remaining content
            const { csvDataList, cleanedContent: contentAfterCSV } =
                parseMultipleCSVData(contentAfterCharts);

            // Then parse table data from the remaining content
            const { tableDataList, cleanedContent: finalCleanedContent } =
                parseMultipleTableData(contentAfterCSV);

            const hasCharts = chartDataList.length > 0;
            const hasCSVData = csvDataList.length > 0;
            const hasTableData = tableDataList.length > 0;

            if (hasCharts || hasCSVData || hasTableData) {
                return (
                    <SpaceBetween size="m">
                        {finalCleanedContent && finalCleanedContent.trim() && (
                            <MarkdownRenderer content={finalCleanedContent} />
                        )}
                        {chartDataList.map((chartData, index) => (
                            <ChartComponent key={`chart-${index}`} chartData={chartData} />
                        ))}
                        {csvDataList.map((csvData: CSVData, index: number) => (
                            <CSVTable key={`csv-${index}`} csvData={csvData} />
                        ))}
                        {tableDataList.map((tableData: TableData, index: number) => (
                            <TableComponent key={`table-${index}`} tableData={tableData} />
                        ))}
                    </SpaceBetween>
                );
            }

            // If no charts, CSV, or table data, render as markdown
            return <MarkdownRenderer content={content} />;
        }

        return content;
    };

    return (
        <div className="messages" role="region" aria-label="Chat">
            <LiveRegion hidden={true} assertive={latestMessage?.type === "alert"}>
                {latestMessage?.type === "alert" && latestMessage.header}
                {latestMessage?.content}
                {latestMessage?.type === "chat-bubble" &&
                    latestMessage.supportPrompts &&
                    `There are ${promptText.length} support prompts accompanying this message. ${promptText}`}
            </LiveRegion>

            {messages.map((message, index) => {
                if (message.type === "alert") {
                    return (
                        <Alert
                            key={"error-alert" + index}
                            header={message.header}
                            type="error"
                            data-testid={"error-alert" + index}
                        >
                            {message.content}
                        </Alert>
                    );
                }

                // Get author info, fallback to creating a dynamic user author if not found
                let author = AUTHORS[message.authorId];
                if (!author && message.authorId.startsWith("user-")) {
                    // Create dynamic user author for unknown user IDs
                    author = {
                        type: "user" as const,
                        name: userInfo?.name || "User",
                        initials: userInfo?.initials || "U",
                    };
                } else if (!author) {
                    // Fallback for any other unknown authorId
                    author = {
                        type: "user" as const,
                        name: "Unknown User",
                        initials: "U",
                    };
                }

                // Create message data for download functionality
                const messageContent =
                    typeof message.content === "string"
                        ? message.content
                        : message.contentToCopy || "";

                const messageData: MessageData = {
                    content: messageContent,
                    timestamp: message.timestamp,
                    authorId: message.authorId,
                    hasCharts: messageHasCharts(messageContent),
                    hasCSV: messageHasCSV(messageContent),
                    hasTables: messageHasTables(messageContent),
                };

                return (
                    <SpaceBetween size="xs" key={`message-${index}-${message.timestamp}`}>
                        <div
                            ref={(el) => {
                                messageRefs.current[index] = el;
                            }}
                            className="chat-bubble-content-wrapper"
                        >
                            <ChatBubble
                                avatar={
                                    <ChatBubbleAvatar
                                        {...author}
                                        loading={message.avatarLoading || message.loading}
                                    />
                                }
                                ariaLabel={`${author.name} at ${message.timestamp}`}
                                type={author.type === "gen-ai" ? "incoming" : "outgoing"}
                                hideAvatar={message.hideAvatar}
                                actions={
                                    message.loading ? null : message.actions === "code-view" ? (
                                        <CodeViewActions
                                            contentToCopy={message.contentToCopy || ""}
                                        />
                                    ) : message.actions === "feedback" ? (
                                        <FeedbackActionsWithDownload
                                            contentToCopy={message.contentToCopy || ""}
                                            messageElement={messageRefs.current[index]}
                                            messageData={messageData}
                                        />
                                    ) : null
                                }
                            >
                                <div>
                                    {message.type === "chat-bubble" &&
                                    message.authorId === "gen-ai" &&
                                    message.parts &&
                                    message.parts.length > 0 ? (
                                        <MessageParts
                                            parts={message.parts}
                                            processContent={processMessageContent}
                                        />
                                    ) : (
                                        processMessageContent(message.content)
                                    )}
                                </div>
                                {/* Sources: only render standalone when no parts[] (backward compat for saved conversations) */}
                                {message.type === "chat-bubble" &&
                                    !message.loading &&
                                    message.authorId === "gen-ai" &&
                                    message.sources &&
                                    (!message.parts || message.parts.length === 0) && (
                                        <SourcesPanel data={message.sources} />
                                    )}
                            </ChatBubble>
                        </div>

                        {message.showFeedbackDialog && (
                            <div className="other-content-vertically-align">
                                <FeedbackDialog
                                    onDismiss={() => setShowFeedbackDialog(index, false)}
                                    onSubmit={() => {
                                        setShowFeedbackDialog(index, false);
                                        addMessage(index + 1, {
                                            type: "chat-bubble",
                                            authorId: "gen-ai",
                                            content:
                                                "Your feedback has been submitted. Thank you for your additional feedback.",
                                            timestamp: new Date().toLocaleTimeString(),
                                            hideAvatar: true,
                                        });
                                    }}
                                />
                            </div>
                        )}

                        {latestMessage.type === "chat-bubble" &&
                            latestMessage.supportPrompts &&
                            index === messages.length - 1 && (
                                <div className="other-content-vertically-align">
                                    {message.supportPrompts}
                                </div>
                            )}
                    </SpaceBetween>
                );
            })}
        </div>
    );
}
