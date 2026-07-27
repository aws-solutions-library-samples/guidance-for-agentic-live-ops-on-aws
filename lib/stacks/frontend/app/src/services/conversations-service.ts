// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Conversations Service — CRUD for saved chat history
 * Uses IAM-signed requests to the conversations Lambda Function URL
 */
import { Sha256 } from "@aws-crypto/sha256-js";
import { HttpRequest } from "@aws-sdk/protocol-http";
import { SignatureV4 } from "@aws-sdk/signature-v4";
import { fetchAuthSession } from "aws-amplify/auth";

const CONVERSATIONS_URL = import.meta.env.VITE_CONVERSATIONS_FUNCTION_URL;
const REGION = import.meta.env.VITE_REGION;

export interface ConversationSummary {
    conversationId: string;
    title: string;
    updatedAt: string;
    messageCount: number;
}

export interface SavedConversation extends ConversationSummary {
    userId: string;
    messages: SerializedMessage[];
    sessionId?: string;
}

export interface SerializedMessage {
    type: string;
    authorId: string;
    content: string;
    timestamp: string;
    sources?: Record<string, unknown>;
    parts?: unknown[];
}

async function signedFetch(method: string, params?: Record<string, string>, body?: unknown) {
    const session = await fetchAuthSession();
    if (!session.credentials) throw new Error("Not authenticated");

    const url = new URL(CONVERSATIONS_URL);
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const request = new HttpRequest({
        method,
        protocol: url.protocol,
        hostname: url.hostname,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: { "Content-Type": "application/json", host: url.hostname },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const signed = await new SignatureV4({
        service: "lambda",
        region: REGION,
        credentials: session.credentials,
        sha256: Sha256,
    }).sign(request);

    const res = await fetch(url.toString(), {
        method,
        headers: signed.headers as HeadersInit,
        ...(body ? { body: signed.body } : {}),
    });

    if (!res.ok) throw new Error(`Conversations API ${res.status}: ${res.statusText}`);
    return res.json();
}

export async function listConversations(): Promise<ConversationSummary[]> {
    const data = await signedFetch("GET");
    return data.conversations ?? [];
}

export async function loadConversation(conversationId: string): Promise<SavedConversation> {
    return signedFetch("GET", { conversationId });
}

export async function saveConversation(
    conversationId: string,
    messages: SerializedMessage[],
    sessionId?: string,
    title?: string
): Promise<{ saved: boolean; conversationId: string }> {
    return signedFetch("POST", undefined, { conversationId, messages, sessionId, title });
}

export async function deleteConversation(conversationId: string): Promise<{ deleted: boolean }> {
    return signedFetch("DELETE", { conversationId });
}
