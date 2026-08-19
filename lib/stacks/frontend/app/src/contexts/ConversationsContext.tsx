// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
    createContext,
    useContext,
    useState,
    useCallback,
    useEffect,
    useRef,
    ReactNode,
} from "react";
import {
    listConversations,
    loadConversation,
    saveConversation,
    deleteConversation,
    ConversationSummary,
    SerializedMessage,
} from "../services/conversations-service";
import { Message, MessagePart } from "../components/Chat/config";

// Stable empty reference so conversations without a buffer don't churn the render.
const EMPTY_MESSAGES: Message[] = [];

/** Rehydrate persisted messages into the in-memory Message shape used by the UI. */
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

interface ConversationsContextType {
    conversations: ConversationSummary[];
    activeId: string;
    /** Messages for the currently-viewed conversation. */
    activeMessages: Message[];
    /** True while the active conversation is a persisted chat whose history is still loading. */
    isActiveLoading: boolean;
    /** Switch the active conversation; its messages are lazily loaded on first view. */
    switchConversation: (id: string) => void;
    /** Update a specific conversation's message buffer, regardless of which is active. */
    updateMessages: (convId: string, updater: (prev: Message[]) => Message[]) => void;
    /** Read a conversation's current message buffer without subscribing to renders. */
    getMessages: (convId: string) => Message[];
    /** Agent session id bound to a specific conversation. */
    getSessionId: (convId: string) => string | undefined;
    setSessionId: (convId: string, sessionId: string | undefined) => void;
    refresh: () => Promise<void>;
    save: (
        messages: SerializedMessage[],
        sessionId?: string,
        title?: string,
        convId?: string
    ) => Promise<void>;
    remove: (id: string) => Promise<void>;
    newChat: () => string;
}

const ConversationsContext = createContext<ConversationsContextType | undefined>(undefined);

export function ConversationsProvider({ children }: { children: ReactNode }) {
    const [conversations, setConversations] = useState<ConversationSummary[]>([]);
    const [activeId, setActiveId] = useState<string>(() => crypto.randomUUID());

    // Per-conversation state, keyed by conversationId. Streaming responses accumulate
    // into their INITIATING conversation's buffer so a mid-stream switch can never
    // render or persist a response into a different (currently-viewed) conversation.
    // Seed the initial blank conversation's buffer so it is immediately sendable: a
    // conversation with NO buffer is treated as still-loading (see isActiveLoading).
    const [buffers, setBuffers] = useState<Record<string, Message[]>>(() => ({ [activeId]: [] }));
    const [sessionIds, setSessionIds] = useState<Record<string, string | undefined>>({});

    // Fresh mirror of buffers so getMessages reads the latest committed value without
    // subscribing to renders (mirrors the sessionIdsRef pattern below).
    const buffersRef = useRef(buffers);
    useEffect(() => {
        buffersRef.current = buffers;
    }, [buffers]);

    // Fresh mirror of sessionIds so getSessionId is both stable and never stale.
    const sessionIdsRef = useRef(sessionIds);
    useEffect(() => {
        sessionIdsRef.current = sessionIds;
    }, [sessionIds]);

    // Tracks conversation ids we've already loaded or created, so each is fetched once.
    // Seed with the initial (blank) conversation so we never fetch it from the server.
    const initializedRef = useRef<Set<string> | null>(null);
    if (initializedRef.current === null) {
        initializedRef.current = new Set([activeId]);
    }

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

    // Lazily load a conversation the first time it becomes active. Never clobber a
    // buffer that already exists (e.g. one an in-flight stream is writing into).
    useEffect(() => {
        const initialized = initializedRef.current;
        if (!initialized || initialized.has(activeId)) return;
        initialized.add(activeId);
        loadConversation(activeId)
            .then((conv) => {
                setBuffers((prev) =>
                    activeId in prev ? prev : { ...prev, [activeId]: deserialize(conv.messages) }
                );
                setSessionIds((prev) =>
                    prev[activeId] ? prev : { ...prev, [activeId]: conv.sessionId }
                );
            })
            .catch(() => {
                // A failed history read must NOT look like an empty conversation. Leave the
                // buffer absent (send stays blocked, isActiveLoading stays true) and drop the
                // id from `initialized` so switching back to it retries the load.
                initialized.delete(activeId);
            });
    }, [activeId]);

    const switchConversation = useCallback((id: string) => {
        setActiveId(id);
    }, []);

    const updateMessages = useCallback(
        (convId: string, updater: (prev: Message[]) => Message[]) => {
            setBuffers((prev) => {
                const next = { ...prev, [convId]: updater(prev[convId] ?? []) };
                // Keep the ref in lockstep so a read-after-write (getMessages called right
                // after updateMessages, as in Chat's stream-complete) sees the fresh buffer.
                buffersRef.current = next;
                return next;
            });
        },
        []
    );

    const getMessages = useCallback(
        (convId: string) => buffersRef.current[convId] ?? EMPTY_MESSAGES,
        []
    );

    const getSessionId = useCallback((convId: string) => sessionIdsRef.current[convId], []);

    const setSessionId = useCallback((convId: string, sessionId: string | undefined) => {
        setSessionIds((prev) => ({ ...prev, [convId]: sessionId }));
    }, []);

    const save = useCallback(
        async (
            messages: SerializedMessage[],
            sessionId?: string,
            title?: string,
            convId?: string
        ) => {
            if (messages.length === 0) return;
            await saveConversation(convId ?? activeId, messages, sessionId, title);
            refresh();
        },
        [activeId, refresh]
    );

    const remove = useCallback(
        async (id: string) => {
            await deleteConversation(id);
            refresh();
        },
        [refresh]
    );

    const newChat = useCallback(() => {
        const id = crypto.randomUUID();
        initializedRef.current?.add(id);
        setBuffers((prev) => ({ ...prev, [id]: [] }));
        setSessionIds((prev) => ({ ...prev, [id]: undefined }));
        setActiveId(id);
        return id;
    }, []);

    const activeMessages = buffers[activeId] ?? EMPTY_MESSAGES;

    // A conversation is sendable once it has a buffer (freshly seeded newChat / the initial
    // blank chat, or a successfully loaded history). No buffer means it is still loading, or
    // a load failed (per S2), so sends must be blocked until the buffer arrives.
    const isActiveLoading = !(activeId in buffers);

    return (
        <ConversationsContext.Provider
            value={{
                conversations,
                activeId,
                activeMessages,
                isActiveLoading,
                switchConversation,
                updateMessages,
                getMessages,
                getSessionId,
                setSessionId,
                refresh,
                save,
                remove,
                newChat,
            }}
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
