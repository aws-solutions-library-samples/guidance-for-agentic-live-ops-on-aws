// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { ContentLayout, Header } from "@cloudscape-design/components";
import { Dispatch, SetStateAction, useCallback, useRef, useState } from "react";
import ChatComponent from "../../components/Chat/chat";
import { Message } from "../../components/Chat/config";
import { Report } from "../../services/monitor-service";
import { useConversations } from "../../contexts/ConversationsContext";

interface ChatProps {
    injectedPrompt?: string;
    injectedReport?: Report;
    onInjectedPromptConsumed?: () => void;
}

const Chat = ({ injectedPrompt, injectedReport, onInjectedPromptConsumed }: ChatProps) => {
    const [isQuestionSelectorVisible, setIsQuestionSelectorVisible] = useState(false);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const [localInjectedPrompt, setLocalInjectedPrompt] = useState<string | undefined>(undefined);
    const { activeId, activeMessages, updateMessages } = useConversations();

    // Message buffers live per-conversation in ConversationsContext. Expose the
    // familiar Dispatch<SetStateAction<Message[]>> signature that targets the active
    // conversation, so ChatComponent's active-view mutations keep working unchanged
    // while streaming writes route through updateMessages(initiatingId, ...).
    const setMessages = useCallback<Dispatch<SetStateAction<Message[]>>>(
        (action) =>
            updateMessages(activeId, (prev) =>
                typeof action === "function"
                    ? (action as (p: Message[]) => Message[])(prev)
                    : action
            ),
        [activeId, updateMessages]
    );

    // Use prop-injected prompt if provided, otherwise local
    const activePrompt = injectedPrompt ?? localInjectedPrompt;
    const handleConsumed = () => {
        onInjectedPromptConsumed?.();
        setLocalInjectedPrompt(undefined);
    };

    return (
        <ContentLayout header={<Header variant="h1">Chat</Header>}>
            <ChatComponent
                messages={activeMessages}
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
