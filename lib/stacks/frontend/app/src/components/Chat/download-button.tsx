// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { useState } from "react";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import { ButtonDropdownProps } from "@cloudscape-design/components/button-dropdown";
import SpaceBetween from "@cloudscape-design/components/space-between";
import {
    downloadMessage,
    messageHasCharts,
    messageHasTables,
    MessageData,
    DownloadOptions,
    debugMessageElement,
} from "./download-utils";

interface DownloadButtonProps {
    messageElement: HTMLElement | null;
    messageData: MessageData;
    variant?: "icon" | "normal";
}

const DownloadButton: React.FC<DownloadButtonProps> = ({
    messageElement,
    messageData,
    variant = "icon",
}) => {
    const [isDownloading, setIsDownloading] = useState(false);
    const hasCharts = messageHasCharts(messageData.content);
    const hasTables = messageHasTables(messageData.content);

    const handleDownload = async (
        format: "pdf" | "json" | "csv",
        includeCharts: boolean = true
    ) => {
        if (!messageElement) {
            console.error("Message element not found");
            return;
        }

        console.log("=== SINGLE MESSAGE DOWNLOAD DEBUG INFO ===");
        console.log("Format:", format);
        console.log("Include charts:", includeCharts);
        console.log("Has charts:", hasCharts);
        console.log("Has tables:", hasTables);
        console.log("Message data:", messageData);

        // Use the debug utility to inspect the message element
        debugMessageElement(messageElement);

        // Also log the message content for debugging
        console.log("Message content preview:", messageData.content.substring(0, 500));
        console.log("Message content length:", messageData.content.length);

        setIsDownloading(true);
        try {
            // Debug: Check for canvas elements before download
            if (includeCharts && (hasCharts || hasTables)) {
                const canvases = messageElement.querySelectorAll("canvas");
                console.log(`Found ${canvases.length} canvas elements for download`);
                canvases.forEach((canvas, index) => {
                    console.log(
                        `Canvas ${index}: ${canvas.width}x${canvas.height}, visible: ${canvas.offsetWidth > 0 && canvas.offsetHeight > 0}, parent: ${canvas.parentElement?.className}`
                    );
                });

                // Also check for chart containers
                const chartContainers = messageElement.querySelectorAll(
                    '[data-testid*="chart"], .chart-container'
                );
                console.log(`Found ${chartContainers.length} chart containers`);

                // Check for table containers
                const tableContainers = messageElement.querySelectorAll(
                    '[data-testid*="table"], .awsui-table'
                );
                console.log(`Found ${tableContainers.length} table containers`);
            }

            const options: DownloadOptions = {
                format,
                includeCharts: includeCharts && (hasCharts || hasTables),
            };

            console.log("Starting download with options:", options);
            await downloadMessage(messageElement, messageData, options);
            console.log("Download completed successfully");
        } catch (error) {
            console.error("Download failed:", error);
            // You could add a toast notification here to inform the user
        } finally {
            setIsDownloading(false);
        }
    };

    const hasVisualContent = hasCharts || hasTables;

    const downloadItems: ButtonDropdownProps.ItemOrGroup[] = [
        {
            text:
                hasCharts && hasTables
                    ? "PDF with Charts & Tables"
                    : hasCharts
                      ? "PDF with Charts"
                      : hasTables
                        ? "PDF with Tables"
                        : "PDF with Visual Content",
            id: "pdf-with-charts",
            disabled: !hasVisualContent,
            description: hasVisualContent
                ? `Download as PDF including ${hasCharts ? "charts" : ""}${hasCharts && hasTables ? " and " : ""}${hasTables ? "tables" : ""}`
                : "No charts or tables in this message",
        },
        {
            text: "PDF (Text Only)",
            id: "pdf-text-only",
            description: "Download as PDF with text content only",
        },
        {
            text: "CSV with Charts",
            id: "csv-with-charts",
            disabled: !hasCharts,
            description: hasCharts
                ? "Download as CSV with chart data expanded into rows"
                : "No charts in this message",
        },
        {
            text: "CSV (Text Only)",
            id: "csv-text-only",
            description: "Download as CSV with text content only",
        },
        {
            text: "JSON Data",
            id: "json",
            description: "Download as structured JSON data",
        },
    ];

    const onItemClick = ({ detail }: { detail: ButtonDropdownProps.ItemClickDetails }) => {
        switch (detail.id) {
            case "pdf-with-charts":
                handleDownload("pdf", true);
                break;
            case "pdf-text-only":
                handleDownload("pdf", false);
                break;
            case "csv-with-charts":
                handleDownload("csv", true);
                break;
            case "csv-text-only":
                handleDownload("csv", false);
                break;
            case "json":
                handleDownload("json");
                break;
        }
    };

    if (variant === "icon") {
        return (
            <ButtonDropdown
                items={downloadItems}
                onItemClick={onItemClick}
                loading={isDownloading}
                variant="icon"
                ariaLabel="Download message"
                disabled={isDownloading}
            >
                <Button
                    iconName="download"
                    variant="icon"
                    ariaLabel="Download message"
                    disabled={isDownloading}
                />
            </ButtonDropdown>
        );
    }

    return (
        <SpaceBetween direction="horizontal" size="xs">
            <ButtonDropdown
                items={downloadItems}
                onItemClick={onItemClick}
                loading={isDownloading}
                variant="normal"
            >
                Download
            </ButtonDropdown>
        </SpaceBetween>
    );
};

export default DownloadButton;
