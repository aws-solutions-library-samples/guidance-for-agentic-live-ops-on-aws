// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { useEffect, useRef, useState } from "react";

import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";

import Link from "@cloudscape-design/components/link";
import PromptInput from "@cloudscape-design/components/prompt-input";
import TextContent from "@cloudscape-design/components/text-content";

import { isVisualRefresh } from "../../common/apply-mode";
import { FittedContainer, ScrollableContainer } from "./common-components";
import { Message, MessagePart } from "./config";
import { useUser } from "../../contexts/UserContext";
import Messages from "./messages";
import { useChat, NormalizedSSEEvent } from "../../hooks/useChat";
import { parseMultipleChartData } from "./chart-parser";
import { QuestionSelector } from "../question-selector";

import ConversationDownload from "./conversation-download";
import { useConversations } from "../../contexts/ConversationsContext";
import AgentsModal from "./agents-modal";

import "../../common/styles/chat.scss";

function upsertPart(parts: MessagePart[], next: MessagePart): MessagePart[] {
    const idx = parts.findIndex((p) => p.id === next.id);
    if (idx >= 0) {
        const updated = [...parts];
        updated[idx] = { ...updated[idx], ...next };
        return updated;
    }
    return [...parts, next];
}

interface ChatProps {
    messages: Message[];
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    isQuestionSelectorVisible: boolean;
    setIsQuestionSelectorVisible: React.Dispatch<React.SetStateAction<boolean>>;
    messagesContainerRef: React.RefObject<HTMLDivElement | null>;
    injectedPrompt?: string;
    injectedReport?: import("../../services/monitor-service").Report;
    onInjectedPromptConsumed?: () => void;
}

export default function Chat({
    messages,
    setMessages,
    isQuestionSelectorVisible,
    setIsQuestionSelectorVisible,
    messagesContainerRef,
    injectedPrompt,
    injectedReport,
    onInjectedPromptConsumed,
}: ChatProps) {
    const { userInfo } = useUser();

    const [prompt, setPrompt] = useState("");
    const promptInputRef = useRef<HTMLTextAreaElement>(null);
    const {
        save: autoSave,
        activeId,
        updateMessages,
        getMessages,
        getSessionId,
        setSessionId,
        isActiveLoading,
    } = useConversations();

    const [reportModalOpen, setReportModalOpen] = useState(false);
    const [agentsModalOpen, setAgentsModalOpen] = useState(false);
    // Keep a local copy of the report so it persists after the injected prompt is consumed
    const [activeReport, setActiveReport] = useState(injectedReport);

    // Chat hook (REST API)
    const { sendMessage, isLoading } = useChat();

    const lastMessageContent = messages[messages.length - 1]?.content;

    // When the monitor panel injects a prompt, set it in the input
    useEffect(() => {
        if (injectedPrompt) {
            setPrompt(injectedPrompt);
            if (injectedReport) setActiveReport(injectedReport);
            onInjectedPromptConsumed?.();
            promptInputRef.current?.focus();
        }
    }, [injectedPrompt, injectedReport, onInjectedPromptConsumed]);

    useEffect(() => {
        // Scroll to the bottom to show the new/latest message
        setTimeout(() => {
            if (messagesContainerRef.current) {
                messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
            }
        }, 0);
    }, [lastMessageContent]);

    const onPromptSend = async ({ detail: { value } }: { detail: { value: string } }) => {
        if (!value || value.length === 0 || isLoading || isActiveLoading) {
            return;
        }

        // Snapshot the conversation this send belongs to. The user may switch to a
        // different conversation while the response streams; every state mutation and
        // the eventual save below must target THIS conversation, never the active view.
        const initiatingId = activeId;
        let streamSessionId = getSessionId(initiatingId);

        // Per-request parts accumulator — local so concurrent streams in different
        // conversations never interleave through shared component state.
        let parts: MessagePart[] = [];

        // Create dynamic authorId based on user info
        const authorId = userInfo?.name
            ? `user-${userInfo.name
                  .toLowerCase()
                  .replace(/\s+/g, "-")
                  .replace(/[^a-z0-9-]/g, "")}`
            : "user-unknown";

        const newMessage: Message = {
            type: "chat-bubble",
            authorId: authorId,
            content: value,
            timestamp: new Date().toLocaleTimeString(),
        };

        updateMessages(initiatingId, (prev) => [...prev, newMessage]);
        setPrompt("");
        setActiveReport(undefined);

        // Add loading message
        const loadingMessage: Message = {
            type: "chat-bubble",
            authorId: "gen-ai",
            content: "Processing your request...",
            timestamp: new Date().toLocaleTimeString(),
            loading: true,
        };

        updateMessages(initiatingId, (prev) => [...prev, loadingMessage]);

        const requestId = `chat-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;

        // Validate input before sending
        if (value.length > 10000) {
            const errorMessage: Message = {
                type: "alert",
                header: "Input Error",
                content: "Message is too long (maximum 10,000 characters)",
            };
            updateMessages(initiatingId, (prev) => {
                const without = prev.filter((m) => m.type !== "chat-bubble" || !m.loading);
                return [...without, errorMessage];
            });
            return;
        }

        const onEvent = (event: NormalizedSSEEvent) => {
            if (event.eventType === "reasoning") {
                const rType = event.reasoningType || "";
                const meta = event.metadata || {};
                const content = event.content || "";

                if (rType === "agent") {
                    const agentName =
                        (meta.agent_name as string) || (meta.agentName as string) || "Agent";
                    const agentId = meta.id
                        ? (meta.id as string)
                        : `agent-${agentName.toLowerCase().replace(/\s+/g, "-")}`;
                    const status = (meta.status as string) || "";

                    if (status === "invoking" || status === "initializing") {
                        parts = upsertPart(parts, {
                            id: agentId,
                            type: "agent-step",
                            agentName,
                            status: "in-progress",
                            query: (meta.agent_query as string) || undefined,
                        });
                    } else {
                        // completed or no status
                        const detail = (meta.agent_result as string) || content || "";
                        parts = upsertPart(parts, {
                            id: agentId,
                            type: "agent-step",
                            agentName,
                            status: "completed",
                            query: (meta.agent_query as string) || undefined,
                            detail,
                        });
                    }
                } else if (rType === "analysis") {
                    parts = upsertPart(parts, {
                        id: `analysis-${Date.now()}`,
                        type: "analysis",
                        label: content.slice(0, 120) || "Analysis",
                        status: "completed",
                    });
                } else if (rType === "memory") {
                    parts = upsertPart(parts, {
                        id: `memory-${Date.now()}`,
                        type: "memory",
                        label: content.slice(0, 120) || "Memory",
                        status: "completed",
                    });
                }

                // Sync parts to the loading message of the initiating conversation
                updateMessages(initiatingId, (prev) => {
                    const copy = [...prev];
                    const idx = copy.findIndex((m) => m.type === "chat-bubble" && m.loading);
                    if (idx >= 0 && copy[idx].type === "chat-bubble") {
                        copy[idx] = {
                            ...copy[idx],
                            type: "chat-bubble" as const,
                            parts: [...parts],
                        };
                    }
                    return copy;
                });
            } else if (event.eventType === "content") {
                const newChunk = event.content || "";
                // Find existing text-main part to accumulate
                const existing = parts.find((p) => p.id === "text-main");
                const accumulated =
                    existing && existing.type === "text" ? existing.content + newChunk : newChunk;

                parts = upsertPart(parts, {
                    id: "text-main",
                    type: "text",
                    content: accumulated,
                });

                updateMessages(initiatingId, (prev) => {
                    const copy = [...prev];
                    const idx = copy.findIndex((m) => m.type === "chat-bubble" && m.loading);
                    if (idx >= 0 && copy[idx].type === "chat-bubble") {
                        copy[idx] = {
                            ...copy[idx],
                            type: "chat-bubble" as const,
                            content: accumulated,
                            parts: [...parts],
                        };
                    }
                    return copy;
                });
            } else if (event.eventType === "sources") {
                const sources = event.sources;
                if (sources) {
                    parts = upsertPart(parts, {
                        id: "sources-main",
                        type: "sources",
                        data: sources,
                    });

                    updateMessages(initiatingId, (prev) => {
                        const copy = [...prev];
                        const idx = copy.findIndex((m) => m.type === "chat-bubble" && m.loading);
                        if (idx >= 0 && copy[idx].type === "chat-bubble") {
                            copy[idx] = {
                                ...copy[idx],
                                type: "chat-bubble" as const,
                                parts: [...parts],
                                sources,
                            };
                        }
                        return copy;
                    });
                }
            } else if (event.eventType === "session_id") {
                if (event.sessionId && event.sessionId !== streamSessionId) {
                    streamSessionId = event.sessionId;
                    setSessionId(initiatingId, event.sessionId);
                }
            } else if (event.eventType === "complete") {
                // Get final content from text-main part
                const textPart = parts.find((p) => p.id === "text-main");
                const finalContent =
                    textPart && textPart.type === "text"
                        ? textPart.content
                        : "No response received. Please try again.";

                // Get final sources from sources-main part
                const sourcesPart = parts.find((p) => p.id === "sources-main");
                const finalSources =
                    sourcesPart && sourcesPart.type === "sources" ? sourcesPart.data : undefined;

                const { cleanedContent } = parseMultipleChartData(finalContent);

                const finalMessage: Message = {
                    type: "chat-bubble",
                    authorId: "gen-ai",
                    content: finalContent,
                    timestamp: new Date().toLocaleTimeString(),
                    actions: "feedback",
                    contentToCopy: cleanedContent || finalContent,
                    loading: false,
                    parts: [...parts],
                    sources: finalSources,
                };

                // Build the committed buffer for the INITIATING conversation deterministically
                // AT CALL TIME: take the freshest snapshot (updateMessages keeps this in
                // lockstep via buffersRef), drop the in-flight loading bubble, and append the
                // final message. This must be computed here, NOT captured from inside a
                // setState updater: a React state updater is not guaranteed to run
                // synchronously at the dispatch site, so reading a variable it assigns is a
                // read-after-write hazard that yields an EMPTY array and silently skips the
                // save (the #8 regression where brand-new conversations were never persisted).
                const finalBuffer: Message[] = [
                    ...getMessages(initiatingId).filter(
                        (m) => m.type !== "chat-bubble" || !m.loading
                    ),
                    finalMessage,
                ];

                // Commit with a PURE updater (no side effects → StrictMode-safe, no double
                // append/save). finalBuffer already folds in all prior messages, so replacing
                // the buffer wholesale keeps the rendered history and the saved payload
                // byte-identical.
                updateMessages(initiatingId, () => finalBuffer);

                // Serialize + persist ONCE (the `complete` event is de-duped upstream in
                // useChat) from the INITIATING conversation's committed buffer — never the
                // active view.
                const serialized = finalBuffer
                    .filter(
                        (m): m is Message & { type: "chat-bubble" } =>
                            m.type === "chat-bubble" && !("loading" in m && m.loading)
                    )
                    .map((m) => ({
                        type: m.type,
                        authorId: m.authorId,
                        content: typeof m.content === "string" ? m.content : "",
                        timestamp: m.timestamp,
                        ...("sources" in m && m.sources
                            ? { sources: m.sources as Record<string, unknown> }
                            : {}),
                        ...("parts" in m && m.parts && m.parts.length > 0
                            ? { parts: m.parts as unknown[] }
                            : {}),
                    }));

                // Never silently swallow a save failure: log it and surface an alert in the
                // initiating conversation so the user knows the turn was not persisted.
                autoSave(serialized, streamSessionId, undefined, initiatingId).catch((err) => {
                    console.error("[Chat] Failed to save conversation", initiatingId, err);
                    updateMessages(initiatingId, (prev) => [
                        ...prev,
                        {
                            type: "alert",
                            header: "Save Failed",
                            content:
                                "Your latest message could not be saved and may not appear in chat history. " +
                                (err instanceof Error ? err.message : String(err)),
                        },
                    ]);
                });
            }
        };

        const onError = (error: unknown) => {
            console.error("[Chat] Stream error:", error);
            const errorMessage: Message = {
                type: "alert",
                header: "Stream Error",
                content:
                    error instanceof Error ? error.message : "An error occurred during streaming",
            };
            updateMessages(initiatingId, (prev) => {
                const without = prev.filter((m) => m.type !== "chat-bubble" || !m.loading);
                return [...without, errorMessage];
            });
        };

        await sendMessage(value, streamSessionId, { onEvent, onError }, requestId);
    };

    const addMessage = (index: number, message: Message) => {
        setMessages((prevMessages) => {
            const updatedMessages = [...prevMessages];
            updatedMessages.splice(index, 0, message);
            return updatedMessages;
        });
    };

    const setShowFeedbackDialog = (index: number, show: boolean) => {
        setMessages((prevMessages) => {
            const updatedMessages = [...prevMessages];
            if (updatedMessages[index] && updatedMessages[index].type === "chat-bubble") {
                updatedMessages[index] = { ...updatedMessages[index], showFeedbackDialog: show };
            }
            return updatedMessages;
        });
    };

    const handleQuestionSelect = (questionText: string) => {
        setIsQuestionSelectorVisible(false);

        // Automatically submit the selected question
        if (questionText && questionText.length > 0 && !isLoading) {
            // Simulate the onPromptSend behavior
            onPromptSend({ detail: { value: questionText } });
        }
    };

    const closeQuestionSelector = () => {
        setIsQuestionSelectorVisible(false);
    };

    return (
        <div className={`chat-container ${!isVisualRefresh && "classic"}`}>
            {/* Action Buttons */}
            <Box padding={{ horizontal: "s", bottom: "s" }}>
                <div
                    style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}
                >
                    <Button
                        variant="primary"
                        iconName="menu"
                        onClick={() => setIsQuestionSelectorVisible(true)}
                    >
                        Browse Questions
                    </Button>
                    <Button
                        variant="normal"
                        iconName="group"
                        onClick={() => setAgentsModalOpen(true)}
                    >
                        View Agents
                    </Button>
                    <ConversationDownload
                        messages={messages}
                        variant="icon"
                        conversationContainer={messagesContainerRef.current}
                    />
                </div>
            </Box>
            <FittedContainer>
                <Container
                    data-testid="chat-container"
                    fitHeight
                    disableContentPaddings
                    footer={
                        <>
                            {/* Report badge */}
                            {activeReport && (
                                <Box margin={{ bottom: "xs" }}>
                                    <button
                                        onClick={() => setReportModalOpen(true)}
                                        style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 6,
                                            padding: "4px 10px",
                                            borderRadius: 16,
                                            border: "1px solid #0073bb",
                                            background: "rgba(0,115,187,0.08)",
                                            color: "#0073bb",
                                            fontSize: 12,
                                            cursor: "pointer",
                                            fontFamily: "inherit",
                                        }}
                                    >
                                        <span>📊</span>
                                        <span>
                                            {activeReport.event_type.replace(/_/g, " ")} report
                                        </span>
                                        <span style={{ opacity: 0.6, fontSize: 10 }}>
                                            click to view
                                        </span>
                                    </button>
                                </Box>
                            )}
                            <PromptInput
                                ref={promptInputRef}
                                onChange={({ detail }) => setPrompt(detail.value)}
                                onAction={onPromptSend}
                                value={prompt}
                                actionButtonAriaLabel={
                                    isLoading
                                        ? "Send message button - processing"
                                        : prompt.length > 10000
                                          ? "Message too long"
                                          : "Send message"
                                }
                                actionButtonIconName="send"
                                ariaLabel={isLoading ? "Prompt input - processing" : "Prompt input"}
                                placeholder="Ask a question (max 10,000 characters)"
                                autoFocus
                                disabled={isLoading || isActiveLoading}
                                minRows={3}
                                maxRows={10}
                            />

                            {/* Character count indicator */}
                            {prompt.length > 9000 && (
                                <Box margin={{ top: "xs" }}>
                                    <StatusIndicator
                                        type={prompt.length > 10000 ? "error" : "warning"}
                                    >
                                        {prompt.length}/10,000 characters
                                        {prompt.length > 10000 && " (too long)"}
                                    </StatusIndicator>
                                </Box>
                            )}
                            <Box
                                color="text-body-secondary"
                                margin={{ top: "xs" }}
                                fontSize="body-s"
                            >
                                Use of this service is subject to the{" "}
                                <Link
                                    href="https://aws.amazon.com/ai/responsible-ai/"
                                    external
                                    variant="primary"
                                    fontSize="inherit"
                                >
                                    AWS Responsible AI Policy
                                </Link>
                                .
                            </Box>
                        </>
                    }
                >
                    <ScrollableContainer ref={messagesContainerRef}>
                        <Messages
                            messages={messages}
                            addMessage={addMessage}
                            setShowFeedbackDialog={setShowFeedbackDialog}
                        />
                    </ScrollableContainer>
                </Container>
            </FittedContainer>

            <QuestionSelector
                isVisible={isQuestionSelectorVisible}
                onQuestionSelect={handleQuestionSelect}
                onClose={closeQuestionSelector}
            />

            <AgentsModal visible={agentsModalOpen} onDismiss={() => setAgentsModalOpen(false)} />

            {/* Injected report modal */}
            {activeReport && reportModalOpen && (
                <Modal
                    visible={reportModalOpen}
                    onDismiss={() => setReportModalOpen(false)}
                    header={`Report: ${activeReport.event_type.replace(/_/g, " ")}`}
                    size="large"
                    footer={
                        <Box float="right">
                            <Button variant="primary" onClick={() => setReportModalOpen(false)}>
                                Close
                            </Button>
                        </Box>
                    }
                >
                    <SpaceBetween direction="vertical" size="m">
                        <Box variant="small" color="text-body-secondary">
                            Rule: {activeReport.rule_id} · Generated:{" "}
                            {new Date(activeReport.created_at).toLocaleString()}
                        </Box>
                        <TextContent>
                            <div style={{ whiteSpace: "pre-wrap" }}>{activeReport.analysis}</div>
                        </TextContent>
                    </SpaceBetween>
                </Modal>
            )}
        </div>
    );
}
