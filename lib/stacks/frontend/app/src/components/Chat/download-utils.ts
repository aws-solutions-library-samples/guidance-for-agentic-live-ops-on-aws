// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import jsPDF from "jspdf";
import "jspdf-autotable";
import { parseMultipleChartData } from "./chart-parser";
import { parseMultipleCSVData, contentHasCSV, CSVData } from "./csv-parser";
import { parseMultipleTableData, contentHasTableData, TableData } from "./table-parser";

// Extend jsPDF interface to include autoTable
declare module "jspdf" {
    interface jsPDF {
        autoTable: (options: {
            head?: string[][];
            body?: string[][];
            startY?: number;
            margin?: { left?: number; right?: number };
            styles?: {
                fontSize?: number;
                cellPadding?: number;
            };
            headStyles?: {
                fillColor?: number[];
                textColor?: number;
                fontStyle?: string;
            };
            alternateRowStyles?: {
                fillColor?: number[];
            };
            tableLineColor?: number[];
            tableLineWidth?: number;
        }) => jsPDF;
        lastAutoTable: {
            finalY: number;
        };
    }
}

/**
 * Cleans icon characters and symbols from text content for PDF export
 */
function cleanIconsFromText(content: string): string {
    if (!content) return content;

    console.log("Cleaning icon characters from text...");
    const originalLength = content.length;

    // Remove common icon font characters and symbols that don't render well in PDF
    const cleanedContent = content
        // Remove various Unicode icon ranges
        .replace(/[\u{1F300}-\u{1F9FF}]/gu, "") // Miscellaneous Symbols and Pictographs
        .replace(/[\u{2600}-\u{26FF}]/gu, "") // Miscellaneous Symbols
        .replace(/[\u{2700}-\u{27BF}]/gu, "") // Dingbats
        .replace(/[\u{1F600}-\u{1F64F}]/gu, "") // Emoticons
        .replace(/[\u{1F680}-\u{1F6FF}]/gu, "") // Transport and Map Symbols
        .replace(/[\u{E000}-\u{F8FF}]/gu, "") // Private Use Area (often used by icon fonts)
        .replace(/[\uF000-\uF8FF]/gu, "") // Additional Private Use Area
        // Remove Font Awesome and other icon font characters
        .replace(/[\uf000-\uf8ff]/gi, "")
        // Remove Cloudscape Design icon characters (common ranges)
        .replace(/[\ue900-\ue9ff]/gi, "") // Custom icon font range
        .replace(/[\uea00-\ueaff]/gi, "") // Additional custom icon range
        // Remove zero-width characters
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        // Remove other problematic characters that might be icons
        .replace(/[\u2190-\u21FF]/g, "") // Arrows
        .replace(/[\u2200-\u22FF]/g, "") // Mathematical Operators
        .replace(/[\u25A0-\u25FF]/g, "") // Geometric Shapes
        // Clean up multiple spaces but preserve paragraph breaks
        .replace(/[ \t]+/g, " ") // Replace multiple spaces/tabs with single space
        .replace(/\n{3,}/g, "\n\n") // Replace 3+ newlines with double newlines (paragraph breaks)
        .trim();

    const removedChars = originalLength - cleanedContent.length;
    if (removedChars > 0) {
        console.log(`Removed ${removedChars} icon/symbol characters from text`);
    }

    return cleanedContent;
}

export interface DownloadOptions {
    format: "pdf" | "json" | "csv";
    includeCharts: boolean;
    filename?: string;
}

export interface MessageData {
    content: string;
    timestamp: string;
    authorId: string;
    hasCharts: boolean;
    hasCSV: boolean;
    hasTables: boolean;
}

/**
 * Downloads a single chat message with optional charts
 */
export async function downloadMessage(
    messageElement: HTMLElement,
    messageData: MessageData,
    options: DownloadOptions = { format: "pdf", includeCharts: true }
): Promise<void> {
    const { format, includeCharts, filename } = options;
    const defaultFilename = `chat-message-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}`;
    const finalFilename = filename || defaultFilename;

    try {
        switch (format) {
            case "pdf":
                // Use the unified PDF generation approach for single messages
                await downloadUnifiedPDF(
                    [messageData],
                    finalFilename,
                    includeCharts,
                    messageElement
                );
                break;
            case "json":
                downloadAsJSON(messageData, finalFilename);
                break;
            case "csv":
                downloadAsCSV(messageData, finalFilename, includeCharts);
                break;
            default:
                throw new Error(`Unsupported format: ${format}`);
        }
    } catch (error) {
        console.error("Error downloading message:", error);
        throw error;
    }
}

/**
 * Downloads multiple chat messages as a single document
 */
export async function downloadConversation(
    messagesData: MessageData[],
    options: DownloadOptions = { format: "pdf", includeCharts: true },
    conversationContainer?: HTMLElement
): Promise<void> {
    const { format, filename } = options;
    const defaultFilename = `chat-conversation-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}`;
    const finalFilename = filename || defaultFilename;

    try {
        switch (format) {
            case "pdf":
                // Use the unified PDF generation approach for conversations
                await downloadUnifiedPDF(
                    messagesData,
                    finalFilename,
                    options.includeCharts,
                    conversationContainer
                );
                break;
            case "json":
                downloadConversationAsJSON(messagesData, finalFilename);
                break;
            case "csv":
                downloadConversationAsCSV(messagesData, finalFilename, options.includeCharts);
                break;
            default:
                throw new Error(`Format ${format} not supported for conversation download`);
        }
    } catch (error) {
        console.error("Error downloading conversation:", error);
        throw error;
    }
}

/**
 * Unified PDF download function that works for both single messages and conversations
 */
async function downloadUnifiedPDF(
    messagesData: MessageData[],
    filename: string,
    includeCharts: boolean,
    containerElement?: HTMLElement
): Promise<void> {
    const pdf = new jsPDF();
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 20;
    let yPosition = margin;

    // Determine if this is a single message or conversation
    const isSingleMessage = messagesData.length === 1;

    // Add title
    pdf.setFontSize(isSingleMessage ? 16 : 18);
    pdf.text(
        isSingleMessage ? "Chat Message Export" : "Chat Conversation Export",
        margin,
        yPosition
    );
    yPosition += isSingleMessage ? 15 : 20;

    if (!isSingleMessage) {
        // Add export info for conversations
        pdf.setFontSize(10);
        pdf.text(`Exported: ${new Date().toLocaleString()}`, margin, yPosition);
        yPosition += 10;
        pdf.text(`Messages: ${messagesData.length}`, margin, yPosition);
        yPosition += 20;
    }

    // Get all chart elements from the container if provided
    let allChartElements: HTMLCanvasElement[] = [];
    if (includeCharts && containerElement) {
        console.log("Starting chart capture for PDF download...");
        // Wait a bit to ensure charts are fully rendered
        await new Promise((resolve) => setTimeout(resolve, 1000));
        allChartElements = await getChartCanvasElements(containerElement);
        console.log(`Found ${allChartElements.length} total chart elements`);

        // Log details about each chart found
        allChartElements.forEach((canvas, index) => {
            console.log(
                `Chart ${index + 1}: ${canvas.width}x${canvas.height}, parent: ${canvas.parentElement?.className}`
            );
        });
    }

    let chartIndex = 0;

    for (let i = 0; i < messagesData.length; i++) {
        const message = messagesData[i];

        // Add message separator for conversations (not needed for single messages)
        if (!isSingleMessage) {
            // Check if we need a new page
            if (yPosition > pageHeight - 60) {
                pdf.addPage();
                yPosition = margin;
            }

            pdf.setFontSize(12);
            pdf.text(`--- Message ${i + 1} ---`, margin, yPosition);
            yPosition += 10;

            // Add timestamp and author
            pdf.setFontSize(9);
            pdf.text(`${message.timestamp} - ${message.authorId}`, margin, yPosition);
            yPosition += 15;
        } else {
            // For single messages, add timestamp and author at the top
            pdf.setFontSize(10);
            pdf.text(`Timestamp: ${message.timestamp}`, margin, yPosition);
            yPosition += 10;
            pdf.text(`Author: ${message.authorId}`, margin, yPosition);
            yPosition += 15;
        }

        // Parse the message content to identify where charts and tables should be placed
        const { cleanedContent: contentAfterCharts, chartDataList } = parseMultipleChartData(
            message.content
        );
        const { cleanedContent: contentAfterTables, tableDataList } =
            parseMultipleTableData(contentAfterCharts);
        const cleanedTextContent = cleanIconsFromText(contentAfterTables);

        // Add content with proper paragraph formatting
        pdf.setFontSize(isSingleMessage ? 12 : 11);

        // Split content into paragraphs first, then process each paragraph
        const paragraphs = cleanedTextContent.split(/\n\s*\n|\r\n\s*\r\n/).filter((p) => p.trim());

        for (let p = 0; p < paragraphs.length; p++) {
            const paragraph = paragraphs[p].trim();
            if (!paragraph) continue;

            // Split each paragraph into lines that fit the page width
            const textLines = pdf.splitTextToSize(paragraph, pageWidth - 2 * margin);

            for (const line of textLines) {
                if (yPosition > pageHeight - margin) {
                    pdf.addPage();
                    yPosition = margin;
                }
                pdf.text(line, margin, yPosition);
                yPosition += isSingleMessage ? 7 : 6;
            }

            // Add extra space between paragraphs (but not after the last paragraph)
            if (p < paragraphs.length - 1) {
                yPosition += isSingleMessage ? 10 : 8;
            }
        }

        // Add tables inline after the text content for this message
        if (tableDataList.length > 0) {
            yPosition += 15; // Add some space before tables

            for (const tableData of tableDataList) {
                // Check if we need a new page for the table
                const estimatedTableHeight = (tableData.rows.length + 2) * 20; // Rough estimate
                if (yPosition + estimatedTableHeight > pageHeight - margin) {
                    pdf.addPage();
                    yPosition = margin;
                }

                // Add table title if available
                if (tableData.title) {
                    pdf.setFontSize(14);
                    pdf.text(tableData.title, margin, yPosition);
                    yPosition += 20;
                }

                try {
                    // Use autoTable to render the table
                    pdf.autoTable({
                        head: [tableData.headers],
                        body: tableData.rows,
                        startY: yPosition,
                        margin: { left: margin, right: margin },
                        styles: {
                            fontSize: 10,
                            cellPadding: 3,
                        },
                        headStyles: {
                            fillColor: [66, 139, 202], // Bootstrap primary blue
                            textColor: 255,
                            fontStyle: "bold",
                        },
                        alternateRowStyles: {
                            fillColor: [245, 245, 245], // Light gray
                        },
                        tableLineColor: [200, 200, 200],
                        tableLineWidth: 0.1,
                    });

                    // Update yPosition to after the table
                    yPosition = pdf.lastAutoTable.finalY + 15;

                    console.log(`Added table to PDF with ${tableData.rows.length} rows`);
                } catch (error) {
                    console.error(`Error rendering table:`, error);
                    // Fallback: add table as text
                    pdf.setFontSize(10);
                    pdf.text(`Table: ${tableData.headers.join(" | ")}`, margin, yPosition);
                    yPosition += 10;
                    tableData.rows.slice(0, 5).forEach((row) => {
                        pdf.text(row.join(" | "), margin, yPosition);
                        yPosition += 8;
                    });
                    if (tableData.rows.length > 5) {
                        pdf.text(
                            `... and ${tableData.rows.length - 5} more rows`,
                            margin,
                            yPosition
                        );
                        yPosition += 8;
                    }
                    yPosition += 10;
                }
            }
        }

        // Add charts inline after the tables for this message
        if (includeCharts && chartDataList.length > 0) {
            yPosition += 15; // Add some space before charts

            for (let j = 0; j < chartDataList.length; j++) {
                const chartData = chartDataList[j];

                // Check if we need a new page for the chart
                const estimatedChartHeight = 200; // Rough estimate
                if (yPosition + estimatedChartHeight > pageHeight - margin) {
                    pdf.addPage();
                    yPosition = margin;
                }

                // Add chart title
                pdf.setFontSize(14);
                pdf.text(chartData.title, margin, yPosition);
                yPosition += 20;

                // Try to find and add the corresponding chart image
                if (chartIndex < allChartElements.length) {
                    const canvas = allChartElements[chartIndex];

                    try {
                        // Convert chart to image and add to PDF
                        const chartImage = canvas.toDataURL("image/png", 1.0);
                        const imgWidth = pageWidth - 2 * margin;
                        const imgHeight = (canvas.height * imgWidth) / canvas.width;

                        // Ensure the image fits on the page
                        const maxHeight = pageHeight - yPosition - margin;
                        const finalHeight = Math.min(imgHeight, maxHeight);
                        const finalWidth = (canvas.width * finalHeight) / canvas.height;

                        // If chart is too tall for remaining space, start a new page
                        if (finalHeight >= maxHeight - 20) {
                            pdf.addPage();
                            yPosition = margin;
                            // Re-add chart title on new page
                            pdf.setFontSize(14);
                            pdf.text(chartData.title, margin, yPosition);
                            yPosition += 20;

                            // Recalculate dimensions for new page
                            const newMaxHeight = pageHeight - yPosition - margin;
                            const newFinalHeight = Math.min(imgHeight, newMaxHeight);
                            const newFinalWidth = (canvas.width * newFinalHeight) / canvas.height;

                            pdf.addImage(
                                chartImage,
                                "PNG",
                                margin,
                                yPosition,
                                newFinalWidth,
                                newFinalHeight
                            );
                            yPosition += newFinalHeight + 10;
                        } else {
                            pdf.addImage(
                                chartImage,
                                "PNG",
                                margin,
                                yPosition,
                                finalWidth,
                                finalHeight
                            );
                            yPosition += finalHeight + 10;
                        }

                        console.log(`Added chart ${chartIndex + 1} to PDF: ${chartData.title}`);
                    } catch (error) {
                        console.error(`Error processing chart ${chartIndex + 1}:`, error);
                        // Add error message to PDF
                        pdf.setFontSize(10);
                        pdf.text(
                            `Error: Could not render chart "${chartData.title}"`,
                            margin,
                            yPosition
                        );
                        yPosition += 15;
                    }

                    chartIndex++;
                } else {
                    // Fallback: just add chart info as text
                    pdf.setFontSize(10);
                    pdf.text(`Chart: ${chartData.title} (${chartData.type})`, margin, yPosition);
                    yPosition += 10;
                    pdf.text(`Note: Chart image could not be captured`, margin, yPosition);
                    yPosition += 15;
                }
            }
        }

        // Add space between messages (only for conversations)
        if (!isSingleMessage) {
            yPosition += 15;
        }
    }

    pdf.save(`${filename}.pdf`);
}

/**
 * Downloads a message as JSON
 */
function downloadAsJSON(messageData: MessageData, filename: string): void {
    const { chartDataList, cleanedContent: contentAfterCharts } = parseMultipleChartData(
        messageData.content
    );
    const { tableDataList, cleanedContent } = parseMultipleTableData(contentAfterCharts);
    const cleanedTextContent = cleanIconsFromText(cleanedContent);

    const exportData = {
        timestamp: messageData.timestamp,
        author: messageData.authorId,
        content: cleanedTextContent,
        charts: chartDataList,
        tables: tableDataList,
        exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.download = `${filename}.json`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
}

/**
 * Downloads entire conversation as JSON
 */
function downloadConversationAsJSON(messagesData: MessageData[], filename: string): void {
    const exportData = {
        exportedAt: new Date().toISOString(),
        messageCount: messagesData.length,
        messages: messagesData.map((message) => {
            const { chartDataList, cleanedContent: contentAfterCharts } = parseMultipleChartData(
                message.content
            );
            const { tableDataList, cleanedContent } = parseMultipleTableData(contentAfterCharts);
            const cleanedTextContent = cleanIconsFromText(cleanedContent);
            return {
                timestamp: message.timestamp,
                author: message.authorId,
                content: cleanedTextContent,
                charts: chartDataList,
                tables: tableDataList,
            };
        }),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.download = `${filename}.json`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
}

/**
 * Utility to get chart canvas elements from a message element with proper waiting
 */
async function getChartCanvasElements(messageElement: HTMLElement): Promise<HTMLCanvasElement[]> {
    console.log("Starting chart canvas search...");

    // Function to check if a canvas is valid and rendered
    const isValidCanvas = (canvas: HTMLCanvasElement): boolean => {
        if (canvas.width === 0 || canvas.height === 0) {
            console.log(`Canvas invalid: dimensions ${canvas.width}x${canvas.height}`);
            return false;
        }

        // Check if canvas has actual content (not just blank)
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            console.log("Canvas invalid: no 2d context");
            return false;
        }

        try {
            const imageData = ctx.getImageData(
                0,
                0,
                Math.min(canvas.width, 100),
                Math.min(canvas.height, 100)
            );
            const data = imageData.data;

            // Check if canvas has non-transparent pixels
            for (let i = 3; i < data.length; i += 4) {
                if (data[i] !== 0) {
                    console.log(`Canvas valid: found content at pixel ${Math.floor(i / 4)}`);
                    return true; // Found non-transparent pixel
                }
            }
            console.log("Canvas appears empty: no non-transparent pixels found");
            return false;
        } catch (error) {
            console.log("Canvas validation error:", error);
            return false;
        }
    };

    // Enhanced search strategy
    const searchStrategies = [
        () => messageElement.querySelectorAll("canvas"),
        () => messageElement.querySelectorAll('[data-testid*="chart"] canvas'),
        () => messageElement.querySelectorAll(".chart-container canvas"),
        () => messageElement.querySelectorAll('[class*="chart"] canvas'),
        () => messageElement.querySelectorAll('div[style*="height"] canvas'),
    ];

    const allCanvases: HTMLCanvasElement[] = [];

    // Try all search strategies
    for (let i = 0; i < searchStrategies.length; i++) {
        const found = Array.from(searchStrategies[i]()) as HTMLCanvasElement[];
        console.log(`Search strategy ${i + 1} found: ${found.length} canvas elements`);

        // Add unique canvases
        found.forEach((canvas) => {
            if (!allCanvases.includes(canvas)) {
                allCanvases.push(canvas);
            }
        });
    }

    console.log(`Total unique canvases found: ${allCanvases.length}`);

    // If no canvas elements found, wait and try again
    if (allCanvases.length === 0) {
        console.log("No canvas found, waiting 2 seconds for Chart.js to render...");
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Retry search
        for (let i = 0; i < searchStrategies.length; i++) {
            const found = Array.from(searchStrategies[i]()) as HTMLCanvasElement[];
            found.forEach((canvas) => {
                if (!allCanvases.includes(canvas)) {
                    allCanvases.push(canvas);
                }
            });
        }
        console.log(`After waiting, total canvases found: ${allCanvases.length}`);
    }

    // Filter for valid canvases with content
    const validCanvases: HTMLCanvasElement[] = [];

    for (const canvas of allCanvases) {
        console.log(`Checking canvas: ${canvas.width}x${canvas.height}`);
        if (isValidCanvas(canvas)) {
            validCanvases.push(canvas);
            console.log(`✓ Canvas added to valid list`);
        } else {
            console.log(`✗ Canvas rejected`);
        }
    }

    // If no valid canvases, wait a bit more and try validation again
    if (validCanvases.length === 0 && allCanvases.length > 0) {
        console.log("Found canvas elements but they appear empty, waiting 2 more seconds...");
        await new Promise((resolve) => setTimeout(resolve, 2000));

        for (const canvas of allCanvases) {
            if (isValidCanvas(canvas)) {
                validCanvases.push(canvas);
            }
        }
    }

    console.log(`Final result: ${validCanvases.length} valid canvas elements for download`);

    // Log details of valid canvases
    validCanvases.forEach((canvas, index) => {
        console.log(
            `Valid canvas ${index + 1}: ${canvas.width}x${canvas.height}, parent: ${canvas.parentElement?.tagName}`
        );
    });

    return validCanvases;
}

/**
 * Utility to get chart canvas elements from a message element
 */
export function getChartsFromMessage(messageElement: HTMLElement): HTMLCanvasElement[] {
    return Array.from(messageElement.querySelectorAll("canvas"));
}

/**
 * Utility to check if a message contains charts
 */
export function messageHasCharts(content: string): boolean {
    const { chartDataList } = parseMultipleChartData(content);
    const hasCharts = chartDataList.length > 0;
    return hasCharts;
}

/**
 * Utility to check if a message contains CSV data
 */
export function messageHasCSV(content: string): boolean {
    return contentHasCSV(content);
}

/**
 * Escapes CSV field content according to RFC 4180
 */
function escapeCSVField(field: string): string {
    if (!field) return '""';

    // Convert to string and handle special characters
    const stringField = String(field);

    // If field contains comma, quote, or newline, wrap in quotes and escape internal quotes
    if (
        stringField.includes(",") ||
        stringField.includes('"') ||
        stringField.includes("\n") ||
        stringField.includes("\r")
    ) {
        return `"${stringField.replace(/"/g, '""')}"`;
    }

    return stringField;
}

/**
 * Downloads a message as CSV
 */
function downloadAsCSV(messageData: MessageData, filename: string, includeCharts: boolean): void {
    // Parse charts, CSV data, and table data
    const { chartDataList, cleanedContent: contentAfterCharts } = parseMultipleChartData(
        messageData.content
    );
    const { csvDataList, cleanedContent: contentAfterCSV } =
        parseMultipleCSVData(contentAfterCharts);
    const { tableDataList, cleanedContent: finalCleanedContent } =
        parseMultipleTableData(contentAfterCSV);
    const cleanedTextContent = cleanIconsFromText(finalCleanedContent);

    let csvContent = "";

    // If message contains CSV data, export that directly
    if (messageData.hasCSV && csvDataList.length > 0) {
        // Export the first CSV data table found in the message
        const csvData = csvDataList[0];

        // Create CSV header
        csvContent =
            csvData.headers.map((header: string) => escapeCSVField(header)).join(",") + "\n";

        // Add data rows
        csvData.rows.forEach((row: string[]) => {
            const csvRow = row.map((cell: string) => escapeCSVField(cell)).join(",");
            csvContent += csvRow + "\n";
        });
    } else if (tableDataList.length > 0) {
        // Export the first table data found in the message
        const tableData = tableDataList[0];

        // Create CSV header
        csvContent =
            tableData.headers.map((header: string) => escapeCSVField(header)).join(",") + "\n";

        // Add data rows
        tableData.rows.forEach((row: string[]) => {
            const csvRow = row.map((cell: string) => escapeCSVField(cell)).join(",");
            csvContent += csvRow + "\n";
        });
    } else if (includeCharts && chartDataList.length > 0) {
        // CSV with chart data expanded into rows
        csvContent =
            "Message_ID,Timestamp,Author,Message_Type,Chart_Title,Chart_Type,Label,Value\n";

        chartDataList.forEach((chart) => {
            chart.labels.forEach((label, dataIndex) => {
                const value = chart.data[dataIndex];
                const row = [
                    "1", // Message ID
                    escapeCSVField(messageData.timestamp),
                    escapeCSVField(messageData.authorId),
                    "chart",
                    escapeCSVField(chart.title),
                    escapeCSVField(chart.type),
                    escapeCSVField(label),
                    value.toString(),
                ].join(",");
                csvContent += row + "\n";
            });
        });

        // Add text content as a separate row if it exists
        if (cleanedTextContent.trim()) {
            const textRow = [
                "1", // Message ID
                escapeCSVField(messageData.timestamp),
                escapeCSVField(messageData.authorId),
                "text",
                "", // No chart title for text
                "", // No chart type for text
                "", // No label for text
                escapeCSVField(cleanedTextContent),
            ].join(",");
            csvContent += textRow + "\n";
        }
    } else {
        // CSV with text-only format
        csvContent = "Message_ID,Timestamp,Author,Message_Type,Content\n";
        const row = [
            "1", // Message ID
            escapeCSVField(messageData.timestamp),
            escapeCSVField(messageData.authorId),
            "text",
            escapeCSVField(cleanedTextContent),
        ].join(",");
        csvContent += row + "\n";
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.download = `${filename}.csv`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
}

/**
 * Downloads entire conversation as CSV
 */
function downloadConversationAsCSV(
    messagesData: MessageData[],
    filename: string,
    includeCharts: boolean
): void {
    let csvContent = "";

    // Check if any message has CSV data or table data
    const hasAnyCSV = messagesData.some((message) => message.hasCSV);
    const hasAnyTables = messagesData.some((message) => contentHasTableData(message.content));

    if (hasAnyCSV || hasAnyTables) {
        // If conversation contains CSV or table data, create a combined export
        csvContent =
            "Message_ID,Timestamp,Author,Data_Type,Table_Title,Column_Header,Row_Index,Cell_Value\n";

        messagesData.forEach((message, messageIndex) => {
            const { csvDataList, cleanedContent: contentAfterCSV } = parseMultipleCSVData(
                message.content
            );
            const { tableDataList, cleanedContent: contentAfterTables } =
                parseMultipleTableData(contentAfterCSV);
            const { chartDataList, cleanedContent: finalCleanedContent } =
                parseMultipleChartData(contentAfterTables);
            const cleanedTextContent = cleanIconsFromText(finalCleanedContent);
            const messageId = (messageIndex + 1).toString();

            // Add CSV data
            csvDataList.forEach((csvData: CSVData, csvIndex: number) => {
                // Add header row
                csvData.headers.forEach((header: string) => {
                    const row = [
                        messageId,
                        escapeCSVField(message.timestamp),
                        escapeCSVField(message.authorId),
                        "csv_header",
                        escapeCSVField(csvData.title || `CSV Table ${csvIndex + 1}`),
                        escapeCSVField(header),
                        "0", // Header row index
                        escapeCSVField(header),
                    ].join(",");
                    csvContent += row + "\n";
                });

                // Add data rows
                csvData.rows.forEach((dataRow: string[], rowIndex: number) => {
                    dataRow.forEach((cell: string, cellIndex: number) => {
                        const row = [
                            messageId,
                            escapeCSVField(message.timestamp),
                            escapeCSVField(message.authorId),
                            "csv_data",
                            escapeCSVField(csvData.title || `CSV Table ${csvIndex + 1}`),
                            escapeCSVField(csvData.headers[cellIndex] || `Column ${cellIndex + 1}`),
                            (rowIndex + 1).toString(),
                            escapeCSVField(cell),
                        ].join(",");
                        csvContent += row + "\n";
                    });
                });
            });

            // Add table data
            tableDataList.forEach((tableData: TableData, tableIndex: number) => {
                // Add header row
                tableData.headers.forEach((header: string) => {
                    const row = [
                        messageId,
                        escapeCSVField(message.timestamp),
                        escapeCSVField(message.authorId),
                        "table_header",
                        escapeCSVField(tableData.title || `Table ${tableIndex + 1}`),
                        escapeCSVField(header),
                        "0", // Header row index
                        escapeCSVField(header),
                    ].join(",");
                    csvContent += row + "\n";
                });

                // Add data rows
                tableData.rows.forEach((dataRow: string[], rowIndex: number) => {
                    dataRow.forEach((cell: string, cellIndex: number) => {
                        const row = [
                            messageId,
                            escapeCSVField(message.timestamp),
                            escapeCSVField(message.authorId),
                            "table_data",
                            escapeCSVField(tableData.title || `Table ${tableIndex + 1}`),
                            escapeCSVField(
                                tableData.headers[cellIndex] || `Column ${cellIndex + 1}`
                            ),
                            (rowIndex + 1).toString(),
                            escapeCSVField(cell),
                        ].join(",");
                        csvContent += row + "\n";
                    });
                });
            });

            // Add chart data if requested
            if (includeCharts) {
                chartDataList.forEach((chart) => {
                    chart.labels.forEach((label, dataIndex) => {
                        const value = chart.data[dataIndex];
                        const row = [
                            messageId,
                            escapeCSVField(message.timestamp),
                            escapeCSVField(message.authorId),
                            "chart",
                            escapeCSVField(chart.title),
                            escapeCSVField(label),
                            dataIndex.toString(),
                            value.toString(),
                        ].join(",");
                        csvContent += row + "\n";
                    });
                });
            }

            // Add text content if it exists
            if (cleanedTextContent.trim()) {
                const textRow = [
                    messageId,
                    escapeCSVField(message.timestamp),
                    escapeCSVField(message.authorId),
                    "text",
                    "", // No table title for text
                    "", // No column header for text
                    "0", // No row index for text
                    escapeCSVField(cleanedTextContent),
                ].join(",");
                csvContent += textRow + "\n";
            }
        });
    } else if (includeCharts) {
        // CSV with chart data expanded into rows
        csvContent =
            "Message_ID,Timestamp,Author,Message_Type,Chart_Title,Chart_Type,Label,Value\n";

        messagesData.forEach((message, messageIndex) => {
            const { chartDataList, cleanedContent } = parseMultipleChartData(message.content);
            const cleanedTextContent = cleanIconsFromText(cleanedContent);
            const messageId = (messageIndex + 1).toString();

            // Add chart data rows
            chartDataList.forEach((chart) => {
                chart.labels.forEach((label, dataIndex) => {
                    const value = chart.data[dataIndex];
                    const row = [
                        messageId,
                        escapeCSVField(message.timestamp),
                        escapeCSVField(message.authorId),
                        "chart",
                        escapeCSVField(chart.title),
                        escapeCSVField(chart.type),
                        escapeCSVField(label),
                        value.toString(),
                    ].join(",");
                    csvContent += row + "\n";
                });
            });

            // Add text content as a separate row if it exists
            if (cleanedTextContent.trim()) {
                const textRow = [
                    messageId,
                    escapeCSVField(message.timestamp),
                    escapeCSVField(message.authorId),
                    "text",
                    "", // No chart title for text
                    "", // No chart type for text
                    "", // No label for text
                    escapeCSVField(cleanedTextContent),
                ].join(",");
                csvContent += textRow + "\n";
            }
        });
    } else {
        // CSV with text-only format
        csvContent = "Message_ID,Timestamp,Author,Message_Type,Content\n";

        messagesData.forEach((message, messageIndex) => {
            const { cleanedContent } = parseMultipleChartData(message.content);
            const cleanedTextContent = cleanIconsFromText(cleanedContent);
            const messageId = (messageIndex + 1).toString();

            const row = [
                messageId,
                escapeCSVField(message.timestamp),
                escapeCSVField(message.authorId),
                "text",
                escapeCSVField(cleanedTextContent),
            ].join(",");
            csvContent += row + "\n";
        });
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.download = `${filename}.csv`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
}
/**
 * Utility to check if a message contains TABLE_DATA format
 */
export function messageHasTableData(content: string): boolean {
    return contentHasTableData(content);
}

/**
 * Utility to check if a message contains any kind of tables (CSV data or TABLE_DATA format)
 */
export function messageHasTables(content: string): boolean {
    return contentHasCSV(content) || contentHasTableData(content);
}

/**
 * Debug utility to log message element structure
 */
export function debugMessageElement(messageElement: HTMLElement): void {
    console.log("Message element debug info:", {
        tagName: messageElement.tagName,
        className: messageElement.className,
        id: messageElement.id,
        childElementCount: messageElement.childElementCount,
        innerHTML: messageElement.innerHTML.substring(0, 200) + "...",
    });
}
