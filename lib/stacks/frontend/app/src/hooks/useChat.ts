// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { useState, useCallback, useRef } from "react";
import { streamAgentEvents } from "../services/stream-service";
import type { MessageSources } from "../components/Chat/config";

export interface ChatResponse {
    content: string;
    sessionId?: string;
}

export interface NormalizedSSEEvent {
    requestId: string;
    eventType: "reasoning" | "content" | "sources" | "session_id" | "complete" | "error";
    reasoningType?: string;
    content?: string;
    metadata?: {
        id?: string;
        agent_name?: string;
        agent_query?: string;
        agent_result?: string;
        status?: "invoking" | "completed" | "error";
        memory_operation?: string;
        memory_status?: string;
        turns_count?: number;
        [key: string]: unknown;
    };
    sources?: MessageSources;
    sessionId?: string;
}

export interface StreamingChatCallbacks {
    onEvent: (event: NormalizedSSEEvent) => void;
    onError?: (error: unknown) => void;
}

export interface UseChatReturn {
    sendMessage: (
        message: string,
        sessionId?: string,
        callbacks?: StreamingChatCallbacks,
        requestId?: string
    ) => Promise<ChatResponse>;
    isLoading: boolean;
}

export function useChat(): UseChatReturn {
    const [isLoading, setIsLoading] = useState(false);
    const completedRequests = useRef(new Set<string>());

    const sendMessage = useCallback(
        async (
            message: string,
            sessionId?: string,
            callbacks?: StreamingChatCallbacks,
            providedRequestId?: string
        ): Promise<ChatResponse> => {
            setIsLoading(true);

            try {
                const requestId =
                    providedRequestId ||
                    `chat-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;

                let finalContent = "";
                let finalSessionId = sessionId;

                await streamAgentEvents(
                    requestId,
                    message,
                    (event) => {
                        if (event.event_type === "reasoning") {
                            const normalized: NormalizedSSEEvent = {
                                requestId,
                                eventType: "reasoning",
                                reasoningType: (event.reasoning_type as string) || "thinking",
                                content: event.content as string | undefined,
                                metadata: event.metadata as NormalizedSSEEvent["metadata"],
                            };
                            callbacks?.onEvent(normalized);
                        } else if (event.event_type === "content") {
                            const newContent = (event.content as string) || "";
                            finalContent += newContent;
                            const normalized: NormalizedSSEEvent = {
                                requestId,
                                eventType: "content",
                                content: newContent,
                            };
                            callbacks?.onEvent(normalized);
                        } else if (event.event_type === "session_id" || event.session_id) {
                            finalSessionId = (event.session_id || event.sessionId) as string;
                            const normalized: NormalizedSSEEvent = {
                                requestId,
                                eventType: "session_id",
                                sessionId: finalSessionId,
                            };
                            callbacks?.onEvent(normalized);
                        } else if (event.event_type === "sources") {
                            const normalized: NormalizedSSEEvent = {
                                requestId,
                                eventType: "sources",
                                sources: event as unknown as MessageSources,
                            };
                            callbacks?.onEvent(normalized);
                        } else if (event.event_type === "complete") {
                            if (completedRequests.current.has(requestId)) {
                                return;
                            }
                            completedRequests.current.add(requestId);
                            setIsLoading(false);
                            const normalized: NormalizedSSEEvent = {
                                requestId,
                                eventType: "complete",
                            };
                            callbacks?.onEvent(normalized);
                        } else if (event.event_type === "error") {
                            const error = new Error(
                                (event.error as string) || "Stream error occurred"
                            );
                            setIsLoading(false);
                            callbacks?.onError?.(error);
                        }
                    },
                    (error) => {
                        console.error("Stream error:", error);
                        setIsLoading(false);
                        callbacks?.onError?.(error);
                    },
                    sessionId
                );

                return {
                    content: finalContent,
                    sessionId: finalSessionId,
                };
            } catch (error) {
                setIsLoading(false);
                throw error;
            }
        },
        []
    );

    return {
        sendMessage,
        isLoading,
    };
}
