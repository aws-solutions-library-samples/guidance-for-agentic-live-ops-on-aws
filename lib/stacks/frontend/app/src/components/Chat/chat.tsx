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
    const [sessionId, setSessionId] = useState<string | undefined>(undefined);
    const { save: autoSave } = useConversations();

    const [reportModalOpen, setReportModalOpen] = useState(false);
    const [agentsModalOpen, setAgentsModalOpen] = useState(false);
    // Keep a local copy of the report so it persists after the injected prompt is consumed
    const [activeReport, setActiveReport] = useState(injectedReport);

    // Chat hook (REST API)
    const { sendMessage, isLoading } = useChat();

    const partsRef = useRef<MessagePart[]>([]);

    const lastMessageContent = messages[messages.length - 1]?.content;

    useEffect(() => {
        setMessages([]);
    }, []);

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
        if (!value || value.length === 0 || isLoading) {
            return;
        }

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

        setMessages((prevMessages) => [...prevMessages, newMessage]);
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

        setMessages((prevMessages) => [...prevMessages, loadingMessage]);

        // Reset parts accumulator for this request
        partsRef.current = [];

        const requestId = `chat-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;

        // Validate input before sending
        if (value.length > 10000) {
            const errorMessage: Message = {
                type: "alert",
                header: "Input Error",
                content: "Message is too long (maximum 10,000 characters)",
            };
            setMessages((prev) => {
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
                        partsRef.current = upsertPart(partsRef.current, {
                            id: agentId,
                            type: "agent-step",
                            agentName,
                            status: "in-progress",
                            query: (meta.agent_query as string) || undefined,
                        });
                    } else {
                        // completed or no status
                        const detail = (meta.agent_result as string) || content || "";
                        partsRef.current = upsertPart(partsRef.current, {
                            id: agentId,
                            type: "agent-step",
                            agentName,
                            status: "completed",
                            query: (meta.agent_query as string) || undefined,
                            detail,
                        });
                    }
                } else if (rType === "analysis") {
                    partsRef.current = upsertPart(partsRef.current, {
                        id: `analysis-${Date.now()}`,
                        type: "analysis",
                        label: content.slice(0, 120) || "Analysis",
                        status: "completed",
                    });
                } else if (rType === "memory") {
                    partsRef.current = upsertPart(partsRef.current, {
                        id: `memory-${Date.now()}`,
                        type: "memory",
                        label: content.slice(0, 120) || "Memory",
                        status: "completed",
                    });
                }

                // Sync partsRef to loading message
                setMessages((prev) => {
                    const copy = [...prev];
                    const idx = copy.findIndex((m) => m.type === "chat-bubble" && m.loading);
                    if (idx >= 0 && copy[idx].type === "chat-bubble") {
                        copy[idx] = {
                            ...copy[idx],
                            type: "chat-bubble" as const,
                            parts: [...partsRef.current],
                        };
                    }
                    return copy;
                });
            } else if (event.eventType === "content") {
                const newChunk = event.content || "";
                // Find existing text-main part to accumulate
                const existing = partsRef.current.find((p) => p.id === "text-main");
                const accumulated =
                    existing && existing.type === "text" ? existing.content + newChunk : newChunk;

                partsRef.current = upsertPart(partsRef.current, {
                    id: "text-main",
                    type: "text",
                    content: accumulated,
                });

                setMessages((prev) => {
                    const copy = [...prev];
                    const idx = copy.findIndex((m) => m.type === "chat-bubble" && m.loading);
                    if (idx >= 0 && copy[idx].type === "chat-bubble") {
                        copy[idx] = {
                            ...copy[idx],
                            type: "chat-bubble" as const,
                            content: accumulated,
                            parts: [...partsRef.current],
                        };
                    }
                    return copy;
                });
            } else if (event.eventType === "sources") {
                const sources = event.sources;
                if (sources) {
                    partsRef.current = upsertPart(partsRef.current, {
                        id: "sources-main",
                        type: "sources",
                        data: sources,
                    });

                    setMessages((prev) => {
                        const copy = [...prev];
                        const idx = copy.findIndex((m) => m.type === "chat-bubble" && m.loading);
                        if (idx >= 0 && copy[idx].type === "chat-bubble") {
                            copy[idx] = {
                                ...copy[idx],
                                type: "chat-bubble" as const,
                                parts: [...partsRef.current],
                                sources,
                            };
                        }
                        return copy;
                    });
                }
            } else if (event.eventType === "session_id") {
                if (event.sessionId && event.sessionId !== sessionId) {
                    setSessionId(event.sessionId);
                }
            } else if (event.eventType === "complete") {
                // Get final content from text-main part
                const textPart = partsRef.current.find((p) => p.id === "text-main");
                const finalContent =
                    textPart && textPart.type === "text"
                        ? textPart.content
                        : "No response received. Please try again.";

                // Get final sources from sources-main part
                const sourcesPart = partsRef.current.find((p) => p.id === "sources-main");
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
                    parts: [...partsRef.current],
                    sources: finalSources,
                };

                setMessages((prev) => {
                    const without = prev.filter((m) => m.type !== "chat-bubble" || !m.loading);
                    const updated = [...without, finalMessage];

                    // Autosave conversation
                    const serialized = updated
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
                    autoSave(serialized, sessionId).catch(() => {});

                    return updated;
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
            setMessages((prev) => {
                const without = prev.filter((m) => m.type !== "chat-bubble" || !m.loading);
                return [...without, errorMessage];
            });
        };

        await sendMessage(value, sessionId, { onEvent, onError }, requestId);
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
                                disabled={isLoading}
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
