// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Lambda Function URL Streaming Service
 * Handles Server-Sent Events (SSE) streaming from Lambda Function URL
 */

import { Sha256 } from "@aws-crypto/sha256-js";
import { HttpRequest } from "@aws-sdk/protocol-http";
import { SignatureV4 } from "@aws-sdk/signature-v4";
import { fetchAuthSession } from "aws-amplify/auth";

export interface StreamEventData {
    request_id: string;
    event: Record<string, unknown>;
    timestamp: string;
}

export interface StreamError {
    error: string;
}

/**
 * Stream events from Lambda Function URL using Server-Sent Events (SSE)
 * This replaces the AppSync Events subscription with direct Lambda streaming
 */
export async function streamAgentEvents(
    requestId: string,
    message: string,
    onEvent: (event: Record<string, unknown>) => void,
    onError?: (error: unknown) => void,
    sessionId?: string
): Promise<() => void> {
    let abortController: AbortController | null = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    try {
        // Get AWS credentials from Cognito Identity Pool
        const session = await fetchAuthSession();
        const credentials = session.credentials;

        if (!credentials) {
            throw new Error("No credentials available");
        }

        const streamUrl = import.meta.env.VITE_STREAM_FUNCTION_URL;
        if (!streamUrl) {
            throw new Error("VITE_STREAM_FUNCTION_URL not configured");
        }

        const url = new URL(streamUrl);
        const body = JSON.stringify({
            request_id: requestId,
            message,
            session_id: sessionId, // Include session_id in the request
        });

        // Create HTTP request for signing
        const request = new HttpRequest({
            method: "POST",
            protocol: url.protocol,
            hostname: url.hostname,
            path: url.pathname,
            headers: {
                "Content-Type": "application/json",
                host: url.hostname,
            },
            body,
        });

        // Sign the request with AWS Signature V4 for Lambda
        const signer = new SignatureV4({
            service: "lambda",
            region: import.meta.env.VITE_REGION,
            credentials,
            sha256: Sha256,
        });

        const signedRequest = await signer.sign(request);

        // Make the streaming request
        const response = await fetch(url.toString(), {
            method: "POST",
            headers: signedRequest.headers as HeadersInit,
            body: signedRequest.body,
            signal: abortController.signal,
        });

        if (!response.ok) {
            console.error("[streamAgentEvents] Response not OK:", {
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
            });

            // Try to read error response body for debugging
            try {
                const errorText = await response.text();
                console.error("[streamAgentEvents] Error response body:", errorText);
            } catch (bodyError) {
                console.error("[streamAgentEvents] Could not read error response body:", bodyError);
            }

            throw new Error(`Stream request failed: ${response.status} ${response.statusText}`);
        }

        if (!response.body) {
            console.error("[streamAgentEvents] No response body available");
            throw new Error("No response body");
        }

        // Read the SSE stream
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // Parse a single SSE event block (may contain multiple "field: value" lines)
        const processEvent = (eventBlock: string) => {
            for (const line of eventBlock.split("\n")) {
                if (!line.startsWith("data: ")) continue;

                const dataStr = line.slice(6).trim();
                if (!dataStr) continue;

                try {
                    let eventData: Record<string, unknown>;

                    // Handle double-encoded payloads: data: "data: {...}"
                    const firstParse = JSON.parse(dataStr);
                    if (typeof firstParse === "string" && firstParse.startsWith("data: ")) {
                        eventData = JSON.parse(firstParse.slice(6)) as Record<string, unknown>;
                    } else if (typeof firstParse === "object" && firstParse !== null) {
                        eventData = firstParse as Record<string, unknown>;
                    } else {
                        console.error(
                            "[streamAgentEvents] Unexpected parsed type:",
                            typeof firstParse
                        );
                        continue;
                    }

                    onEvent(eventData);
                } catch (parseError) {
                    console.error(
                        "[streamAgentEvents] Failed to parse SSE data:",
                        parseError,
                        line.substring(0, 200)
                    );
                }
            }
        };

        const processStream = async () => {
            try {
                while (true) {
                    const { done, value } = await reader!.read();

                    if (done) {
                        console.log("[streamAgentEvents] Stream completed");
                        // Flush any remaining buffered data
                        if (buffer.trim()) {
                            processEvent(buffer);
                            buffer = "";
                        }
                        // Send completion event when stream ends
                        onEvent({ event_type: "complete" });
                        break;
                    }

                    // Decode chunk and add to buffer
                    const chunk = decoder.decode(value, { stream: true });
                    buffer += chunk;

                    // SSE events are separated by double newlines (\n\n)
                    // Split on \n\n to get complete event blocks
                    const events = buffer.split("\n\n");
                    buffer = events.pop() ?? ""; // Last element may be incomplete

                    for (const eventBlock of events) {
                        if (eventBlock.trim()) {
                            processEvent(eventBlock);
                        }
                    }
                }
            } catch (error) {
                if (error instanceof Error && error.name === "AbortError") {
                    // stream aborted intentionally
                } else {
                    console.error("[streamAgentEvents] Stream error:", error);
                    if (onError) onError(error);
                }
            }
        };

        // Start processing stream
        processStream();
    } catch (error) {
        console.error("[streamAgentEvents] Failed to start stream:", error);
        if (onError) onError(error);
    }

    // Return cleanup function
    return () => {
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
        if (reader) {
            reader.cancel();
            reader = null;
        }
    };
}
