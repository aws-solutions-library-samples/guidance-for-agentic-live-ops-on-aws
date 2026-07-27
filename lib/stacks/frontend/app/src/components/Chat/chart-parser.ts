// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export interface ChartData {
    type: "bar" | "line" | "pie" | "doughnut";
    title: string;
    labels: string[];
    data: number[];
}

/**
 * Parses CHART_DATA sections from agent response text
 * Expected format:
 * CHART_DATA:
 * Type: bar
 * Title: Character Acquisition Trends by Player Level
 * Labels: Level 70-75, Level 76-80, Level 81-85, Level 86-90
 * Data: 45.2, 32.8, 18.7, 3.3
 * END_CHART_DATA
 */
export function parseChartData(content: string): {
    chartData: ChartData | null;
    cleanedContent: string;
} {
    const chartDataRegex = /CHART_DATA:\s*\n([\s\S]*?)\nEND_CHART_DATA/g;
    const match = chartDataRegex.exec(content);

    if (!match) {
        return { chartData: null, cleanedContent: content };
    }

    const chartSection = match[1];
    const lines = chartSection
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line);

    let type: "bar" | "line" | "pie" | "doughnut" = "bar";
    let title = "";
    let labels: string[] = [];
    let data: number[] = [];

    for (const line of lines) {
        if (line.startsWith("Type:")) {
            const typeValue = line.substring(5).trim().toLowerCase();
            if (["bar", "line", "pie", "doughnut"].includes(typeValue)) {
                type = typeValue as "bar" | "line" | "pie" | "doughnut";
            }
        } else if (line.startsWith("Title:")) {
            title = line.substring(6).trim();
        } else if (line.startsWith("Labels:")) {
            const labelsString = line.substring(7).trim();
            labels = labelsString.split(",").map((label) => label.trim());
        } else if (line.startsWith("Data:")) {
            const dataString = line.substring(5).trim();
            data = dataString
                .split(",")
                .map((value) => parseFloat(value.trim()))
                .filter((num) => !isNaN(num));
        }
    }

    // Validate that we have all required data
    if (!title || labels.length === 0 || data.length === 0 || labels.length !== data.length) {
        console.warn("Invalid chart data format:", { type, title, labels, data });
        return { chartData: null, cleanedContent: content };
    }

    const chartData: ChartData = {
        type,
        title,
        labels,
        data,
    };

    // Remove the chart data section from the content
    const cleanedContent = content.replace(chartDataRegex, "").trim();

    return { chartData, cleanedContent };
}

/**
 * Parses multiple CHART_DATA sections from agent response text
 */
export function parseMultipleChartData(content: string): {
    chartDataList: ChartData[];
    cleanedContent: string;
} {
    const chartDataRegex = /CHART_DATA:\s*\n([\s\S]*?)\nEND_CHART_DATA/g;
    const chartDataList: ChartData[] = [];

    // Find all matches first
    const matches = Array.from(content.matchAll(chartDataRegex));

    for (const match of matches) {
        const chartSection = match[1];
        const lines = chartSection
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line);

        let type: "bar" | "line" | "pie" | "doughnut" = "bar";
        let title = "";
        let labels: string[] = [];
        let data: number[] = [];

        for (const line of lines) {
            if (line.startsWith("Type:")) {
                const typeValue = line.substring(5).trim().toLowerCase();
                if (["bar", "line", "pie", "doughnut"].includes(typeValue)) {
                    type = typeValue as "bar" | "line" | "pie" | "doughnut";
                }
            } else if (line.startsWith("Title:")) {
                title = line.substring(6).trim();
            } else if (line.startsWith("Labels:")) {
                const labelsString = line.substring(7).trim();
                labels = labelsString.split(",").map((label) => label.trim());
            } else if (line.startsWith("Data:")) {
                const dataString = line.substring(5).trim();
                data = dataString
                    .split(",")
                    .map((value) => parseFloat(value.trim()))
                    .filter((num) => !isNaN(num));
            }
        }

        // Validate that we have all required data
        if (title && labels.length > 0 && data.length > 0 && labels.length === data.length) {
            chartDataList.push({
                type,
                title,
                labels,
                data,
            });
        } else {
            console.warn("Invalid chart data format:", { type, title, labels, data });
        }
    }

    // Remove all chart data sections from the content
    const cleanedContent = content.replace(chartDataRegex, "").trim();

    return { chartDataList, cleanedContent };
}
