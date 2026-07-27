// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { forwardRef } from "react";

import Avatar from "@cloudscape-design/chat-components/avatar";
import ButtonGroup from "@cloudscape-design/components/button-group";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import SpaceBetween from "@cloudscape-design/components/space-between";

import { AuthorAvatarProps } from "./config";
import DownloadButton from "./download-button";
import { MessageData } from "./download-utils";

export function ChatBubbleAvatar({ type, name, initials, loading }: AuthorAvatarProps) {
    if (type === "gen-ai") {
        return (
            <Avatar
                color="gen-ai"
                iconName="gen-ai"
                tooltipText={name}
                ariaLabel={name}
                loading={loading}
            />
        );
    }

    return <Avatar initials={initials} tooltipText={name} ariaLabel={name} />;
}

export function CodeViewActions({ contentToCopy }: { contentToCopy: string }) {
    return (
        <ButtonGroup
            ariaLabel="Code snippet actions"
            variant="icon"
            onItemClick={({ detail }) => {
                if (detail.id !== "copy" || !navigator.clipboard) {
                    return;
                }

                // eslint-disable-next-line no-console
                navigator.clipboard
                    .writeText(contentToCopy)
                    .catch((error) => console.log("Failed to copy", error.message));
            }}
            items={[
                {
                    type: "group",
                    text: "Feedback",
                    items: [
                        {
                            type: "icon-button",
                            id: "run-command",
                            iconName: "play",
                            text: "Run command",
                        },
                        {
                            type: "icon-button",
                            id: "send-cloudshell",
                            iconName: "script",
                            text: "Send to IDE",
                        },
                    ],
                },
                {
                    type: "icon-button",
                    id: "copy",
                    iconName: "copy",
                    text: "Copy",
                    popoverFeedback: (
                        <StatusIndicator type="success">Message copied</StatusIndicator>
                    ),
                },
            ]}
        />
    );
}

export const FittedContainer = ({ children }: { children: React.ReactNode }) => {
    return (
        <div style={{ position: "relative", flexGrow: 1 }}>
            <div style={{ position: "absolute", inset: 0 }}>{children}</div>
        </div>
    );
};

export const ScrollableContainer = forwardRef(function ScrollableContainer(
    { children }: { children: React.ReactNode },
    ref: React.Ref<HTMLDivElement>
) {
    return (
        <div style={{ position: "relative", blockSize: "100%" }}>
            <div
                style={{ position: "absolute", inset: 0, overflowY: "auto" }}
                ref={ref}
                data-testid="chat-scroll-container"
            >
                {children}
            </div>
        </div>
    );
});

export function FeedbackActionsWithDownload({
    contentToCopy,
    messageElement,
    messageData,
}: {
    contentToCopy: string;
    messageElement?: HTMLElement | null;
    messageData?: MessageData;
}) {
    return (
        <SpaceBetween direction="horizontal" size="xs">
            <ButtonGroup
                ariaLabel="Chat actions"
                variant="icon"
                items={[
                    {
                        type: "icon-button",
                        id: "copy",
                        iconName: "copy",
                        text: "Copy",
                        popoverFeedback: (
                            <StatusIndicator type="success">Message copied</StatusIndicator>
                        ),
                    },
                ]}
                onItemClick={({ detail }) => {
                    if (detail.id === "copy" && navigator.clipboard) {
                        navigator.clipboard
                            .writeText(contentToCopy)
                            // eslint-disable-next-line no-console
                            .catch((error) => console.log("Failed to copy", error.message));
                    }
                }}
            />
            {messageElement && messageData && (
                <DownloadButton
                    messageElement={messageElement}
                    messageData={messageData}
                    variant="icon"
                />
            )}
        </SpaceBetween>
    );
}
