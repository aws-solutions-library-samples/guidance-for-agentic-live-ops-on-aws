// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { useState } from "react";
import Button from "@cloudscape-design/components/button";

import Modal from "@cloudscape-design/components/modal";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Checkbox from "@cloudscape-design/components/checkbox";
import {
    downloadConversation,
    MessageData,
    DownloadOptions,
    messageHasCharts,
    messageHasCSV,
    messageHasTables,
} from "./download-utils";
import { Message } from "./config";

interface ConversationDownloadProps {
    messages: Message[];
    variant?: "icon" | "normal";
    conversationContainer?: HTMLElement | null;
}

const ConversationDownload: React.FC<ConversationDownloadProps> = ({
    messages,
    variant = "normal",
    conversationContainer,
}) => {
    const [isDownloading, setIsDownloading] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [filename, setFilename] = useState("");
    const [includeCharts, setIncludeCharts] = useState(true);
    const [selectedFormat, setSelectedFormat] = useState<"pdf" | "json" | "csv">("pdf");

    // Convert messages to MessageData format
    const messageData: MessageData[] = messages
        .filter((msg) => msg.type === "chat-bubble")
        .map((msg) => {
            const content = typeof msg.content === "string" ? msg.content : "";
            return {
                content,
                timestamp: msg.timestamp,
                authorId: msg.authorId,
                hasCharts: messageHasCharts(content),
                hasCSV: messageHasCSV(content),
                hasTables: messageHasTables(content),
            };
        });

    const hasAnyCharts = messageData.some((msg) => msg.hasCharts);
    const hasAnyCSV = messageData.some((msg) => msg.hasCSV);
    const hasAnyTables = messageData.some((msg) => msg.hasTables);

    const handleDownload = async () => {
        setIsDownloading(true);
        try {
            console.log("=== CONVERSATION DOWNLOAD DEBUG INFO ===");
            console.log("Format:", selectedFormat);
            console.log("Include charts:", includeCharts && hasAnyCharts);
            console.log("Has any charts:", hasAnyCharts);
            console.log("Has any CSV:", hasAnyCSV);
            console.log("Has any tables:", hasAnyTables);
            console.log("Message count:", messageData.length);
            console.log("Conversation container:", conversationContainer);

            const options: DownloadOptions = {
                format: selectedFormat,
                includeCharts: includeCharts && hasAnyCharts,
                filename: filename || undefined,
            };

            console.log("Starting conversation download with options:", options);
            await downloadConversation(messageData, options, conversationContainer || undefined);
            console.log("Conversation download completed successfully");
            setShowModal(false);
        } catch (error) {
            console.error("Download failed:", error);
        } finally {
            setIsDownloading(false);
        }
    };

    const defaultFilename = `chat-conversation-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}`;

    return (
        <>
            {variant === "icon" ? (
                <Button
                    iconName="download"
                    variant="icon"
                    ariaLabel="Download conversation"
                    disabled={messages.length === 0}
                    onClick={() => setShowModal(true)}
                />
            ) : (
                <Button
                    variant="normal"
                    iconName="download"
                    onClick={() => setShowModal(true)}
                    disabled={messages.length === 0}
                    fullWidth
                >
                    Download Conversation
                </Button>
            )}

            <Modal
                onDismiss={() => setShowModal(false)}
                visible={showModal}
                header="Download Conversation"
                footer={
                    <Box float="right">
                        <SpaceBetween direction="horizontal" size="xs">
                            <Button variant="link" onClick={() => setShowModal(false)}>
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                onClick={handleDownload}
                                loading={isDownloading}
                                disabled={messageData.length === 0}
                            >
                                Download
                            </Button>
                        </SpaceBetween>
                    </Box>
                }
            >
                <SpaceBetween size="m">
                    <Box>
                        <strong>Conversation Summary:</strong>
                        <ul>
                            <li>{messageData.length} messages</li>
                            <li>{hasAnyCharts ? "Contains charts" : "No charts"}</li>
                            <li>{hasAnyCSV ? "Contains CSV data" : "No CSV data"}</li>
                            <li>{hasAnyTables ? "Contains tables" : "No tables"}</li>
                        </ul>
                    </Box>

                    <FormField label="Filename (optional)">
                        <Input
                            value={filename}
                            onChange={({ detail }) => setFilename(detail.value)}
                            placeholder={defaultFilename}
                        />
                    </FormField>

                    <FormField label="Format">
                        <SpaceBetween direction="horizontal" size="m">
                            <Button
                                variant={selectedFormat === "pdf" ? "primary" : "normal"}
                                onClick={() => setSelectedFormat("pdf")}
                            >
                                PDF
                            </Button>
                            <Button
                                variant={selectedFormat === "csv" ? "primary" : "normal"}
                                onClick={() => setSelectedFormat("csv")}
                            >
                                CSV
                            </Button>
                            <Button
                                variant={selectedFormat === "json" ? "primary" : "normal"}
                                onClick={() => setSelectedFormat("json")}
                            >
                                JSON
                            </Button>
                        </SpaceBetween>
                    </FormField>

                    {hasAnyCharts && (
                        <FormField label="Chart Options">
                            <Checkbox
                                checked={includeCharts}
                                onChange={({ detail }) => setIncludeCharts(detail.checked)}
                            >
                                Include chart information
                                {selectedFormat === "pdf" &&
                                    " (charts will be listed with titles and types)"}
                                {selectedFormat === "csv" &&
                                    " (chart data will be expanded into individual rows)"}
                                {selectedFormat === "json" &&
                                    " (chart data will be included in structured format)"}
                            </Checkbox>
                        </FormField>
                    )}
                </SpaceBetween>
            </Modal>
        </>
    );
};

export default ConversationDownload;
