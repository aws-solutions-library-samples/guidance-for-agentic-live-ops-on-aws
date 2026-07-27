// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { ContentLayout, Header } from "@cloudscape-design/components";
import { useEffect, useRef, useState } from "react";
import ChatComponent from "../../components/Chat/chat";
import { Message, MessagePart } from "../../components/Chat/config";
import { Report } from "../../services/monitor-service";
import { useConversations } from "../../contexts/ConversationsContext";
import { SerializedMessage } from "../../services/conversations-service";

interface ChatProps {
    injectedPrompt?: string;
    injectedReport?: Report;
    onInjectedPromptConsumed?: () => void;
}

function deserialize(msgs: SerializedMessage[]): Message[] {
    return msgs.map((m) => ({
        type: "chat-bubble" as const,
        authorId: m.authorId,
        content: m.content,
        timestamp: m.timestamp,
        ...(m.sources ? { sources: m.sources } : {}),
        ...(m.parts && m.parts.length > 0 ? { parts: m.parts as MessagePart[] } : {}),
        ...(m.authorId === "gen-ai"
            ? { actions: "feedback" as const, contentToCopy: m.content }
            : {}),
    }));
}

const Chat = ({ injectedPrompt, injectedReport, onInjectedPromptConsumed }: ChatProps) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [isQuestionSelectorVisible, setIsQuestionSelectorVisible] = useState(false);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const [localInjectedPrompt, setLocalInjectedPrompt] = useState<string | undefined>(undefined);
    const { activeId, load } = useConversations();
    const prevActiveId = useRef(activeId);

    // When activeId changes (sidebar click or new chat), load or clear messages
    useEffect(() => {
        if (activeId !== prevActiveId.current) {
            prevActiveId.current = activeId;
            load(activeId)
                .then((msgs) => setMessages(deserialize(msgs)))
                .catch(() => setMessages([])); // New chat or not found — clear
        }
    }, [activeId, load]);

    // Use prop-injected prompt if provided, otherwise local
    const activePrompt = injectedPrompt ?? localInjectedPrompt;
    const handleConsumed = () => {
        onInjectedPromptConsumed?.();
        setLocalInjectedPrompt(undefined);
    };

    return (
        <ContentLayout header={<Header variant="h1">Chat</Header>}>
            <ChatComponent
                messages={messages}
                setMessages={setMessages}
                isQuestionSelectorVisible={isQuestionSelectorVisible}
                setIsQuestionSelectorVisible={setIsQuestionSelectorVisible}
                messagesContainerRef={messagesContainerRef}
                injectedPrompt={activePrompt}
                injectedReport={injectedReport}
                onInjectedPromptConsumed={handleConsumed}
            />
        </ContentLayout>
    );
};

export default Chat;
