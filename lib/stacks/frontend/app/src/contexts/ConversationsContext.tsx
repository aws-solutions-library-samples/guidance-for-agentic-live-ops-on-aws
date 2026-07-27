// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import {
    listConversations,
    loadConversation,
    saveConversation,
    deleteConversation,
    ConversationSummary,
    SerializedMessage,
} from "../services/conversations-service";

interface ConversationsContextType {
    conversations: ConversationSummary[];
    activeId: string;
    setActiveId: (id: string) => void;
    refresh: () => Promise<void>;
    save: (messages: SerializedMessage[], sessionId?: string, title?: string) => Promise<void>;
    load: (id: string) => Promise<SerializedMessage[]>;
    remove: (id: string) => Promise<void>;
    newChat: () => string;
}

const ConversationsContext = createContext<ConversationsContextType | undefined>(undefined);

export function ConversationsProvider({ children }: { children: ReactNode }) {
    const [conversations, setConversations] = useState<ConversationSummary[]>([]);
    const [activeId, setActiveId] = useState<string>(() => crypto.randomUUID());

    const refresh = useCallback(async () => {
        try {
            const list = await listConversations();
            setConversations(list);
        } catch {
            // silently fail
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const save = useCallback(
        async (messages: SerializedMessage[], sessionId?: string, title?: string) => {
            if (messages.length === 0) return;
            await saveConversation(activeId, messages, sessionId, title);
            refresh();
        },
        [activeId, refresh]
    );

    const load = useCallback(async (id: string) => {
        const conv = await loadConversation(id);
        setActiveId(conv.conversationId);
        return conv.messages;
    }, []);

    const remove = useCallback(
        async (id: string) => {
            await deleteConversation(id);
            refresh();
        },
        [refresh]
    );

    const newChat = useCallback(() => {
        const id = crypto.randomUUID();
        setActiveId(id);
        return id;
    }, []);

    return (
        <ConversationsContext.Provider
            value={{ conversations, activeId, setActiveId, refresh, save, load, remove, newChat }}
        >
            {children}
        </ConversationsContext.Provider>
    );
}

export function useConversations() {
    const ctx = useContext(ConversationsContext);
    if (!ctx) throw new Error("useConversations must be used within ConversationsProvider");
    return ctx;
}
