// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { useState, useEffect } from "react";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Badge from "@cloudscape-design/components/badge";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { Icon } from "@cloudscape-design/components";

interface StreamEvent {
    id: string;
    type: "start" | "content" | "complete" | "error";
    timestamp: string;
    data?: Record<string, unknown> | null;
    message?: string;
}

interface EventStreamProps {
    isVisible: boolean;
    onToggle: () => void;
}

export function EventStream({ isVisible, onToggle }: EventStreamProps) {
    const [events, setEvents] = useState<StreamEvent[]>([]);
    const [connectionStatus, setConnectionStatus] = useState<
        "idle" | "connecting" | "connected" | "error"
    >("idle");

    const getEventTypeColor = (type: string) => {
        switch (type) {
            case "start":
                return "blue";
            case "content":
                return "green";
            case "complete":
                return "green";
            case "error":
                return "red";
            default:
                return "grey";
        }
    };

    const getEventTypeIcon = (type: string): "loading" | "success" | "error" | "info" => {
        switch (type) {
            case "start":
                return "loading";
            case "content":
                return "success";
            case "complete":
                return "success";
            case "error":
                return "error";
            default:
                return "info";
        }
    };

    const formatEventData = (event: StreamEvent): string => {
        if (event.type === "content" && event.data) {
            const dataStr =
                typeof event.data === "string" ? event.data : JSON.stringify(event.data);
            return dataStr.length > 100 ? `${dataStr.substring(0, 100)}...` : dataStr;
        }
        if (event.message) {
            return event.message;
        }
        return JSON.stringify(event.data || {}, null, 2);
    };

    // Listen for custom events from the chat hook
    useEffect(() => {
        const handleStreamEvent = (event: CustomEvent<StreamEvent>) => {
            const eventDetail = event.detail;
            setEvents((prev) => [...prev, eventDetail]);

            // Update connection status based on event type
            switch (eventDetail.type) {
                case "start":
                    setConnectionStatus("connecting");
                    break;
                case "content":
                    setConnectionStatus("connected");
                    break;
                case "complete":
                    setConnectionStatus("idle");
                    break;
                case "error":
                    setConnectionStatus("error");
                    break;
            }
        };

        window.addEventListener("chat-stream-event", handleStreamEvent as EventListener);

        return () => {
            window.removeEventListener("chat-stream-event", handleStreamEvent as EventListener);
        };
    }, []);

    const clearEvents = () => {
        setEvents([]);
        setConnectionStatus("idle");
    };

    const getConnectionStatusColor = () => {
        switch (connectionStatus) {
            case "connecting":
                return "blue";
            case "connected":
                return "green";
            case "error":
                return "red";
            default:
                return "grey";
        }
    };

    const getConnectionStatusText = () => {
        switch (connectionStatus) {
            case "connecting":
                return "Connecting...";
            case "connected":
                return "Connected";
            case "error":
                return "Connection Error";
            default:
                return "Idle";
        }
    };

    if (!isVisible) {
        return (
            <Box margin={{ bottom: "s" }}>
                <Button variant="link" onClick={onToggle} iconName="view-horizontal">
                    Show API Events
                </Button>
            </Box>
        );
    }

    return (
        <Container
            header={
                <Header
                    variant="h3"
                    actions={
                        <SpaceBetween direction="horizontal" size="xs">
                            <Button variant="normal" onClick={clearEvents} iconName="refresh">
                                Clear
                            </Button>
                            <Button variant="link" onClick={onToggle} iconName="view-vertical">
                                Hide
                            </Button>
                        </SpaceBetween>
                    }
                >
                    API Event Stream
                    <SpaceBetween direction="horizontal" size="xs">
                        <Badge color={getConnectionStatusColor()}>
                            {getConnectionStatusText()}
                        </Badge>
                        <Badge color={events.length > 0 ? "green" : "grey"}>
                            {events.length} events
                        </Badge>
                    </SpaceBetween>
                </Header>
            }
        >
            <Box>
                {events.length === 0 ? (
                    <Box textAlign="center" color="text-body-secondary">
                        <Icon name="status-info" size="medium" />
                        <Box margin={{ top: "s" }}>
                            No events yet. Send a message to see real-time API events.
                        </Box>
                    </Box>
                ) : (
                    <SpaceBetween direction="vertical" size="xs">
                        {events.slice(-10).map((event, index) => (
                            <Box key={`${event.id}-${index}`} padding="s">
                                <SpaceBetween direction="horizontal" size="s" alignItems="center">
                                    <StatusIndicator type={getEventTypeIcon(event.type)}>
                                        <Badge color={getEventTypeColor(event.type)}>
                                            {event.type.toUpperCase()}
                                        </Badge>
                                    </StatusIndicator>
                                    <Box fontSize="body-s" color="text-body-secondary">
                                        {new Date(event.timestamp).toLocaleTimeString()}
                                    </Box>
                                </SpaceBetween>
                                {(event.data || event.message) && (
                                    <Box margin={{ top: "xs" }} fontSize="body-s" padding="xs">
                                        {formatEventData(event)}
                                    </Box>
                                )}
                            </Box>
                        ))}
                    </SpaceBetween>
                )}
            </Box>
        </Container>
    );
}
