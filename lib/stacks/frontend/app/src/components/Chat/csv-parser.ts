// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export interface CSVData {
    headers: string[];
    rows: string[][];
    title?: string;
}

/**
 * Checks if content contains CSV data markers
 */
export function contentHasCSV(content: string): boolean {
    return content.includes("CSV_DATA_START") && content.includes("CSV_DATA_END");
}

/**
 * Parses CSV data from content with CSV_DATA_START and CSV_DATA_END markers
 */
export function parseCSVData(content: string): CSVData | null {
    const csvMatch = content.match(/CSV_DATA_START\s*(.*?)\s*CSV_DATA_END/s);
    if (!csvMatch) return null;

    const csvContent = csvMatch[1].trim();
    const lines = csvContent.split("\n").filter((line) => line.trim());

    if (lines.length < 2) return null;

    const headers = parseCSVLine(lines[0]);
    const rows = lines.slice(1).map((line) => parseCSVLine(line));

    return {
        headers,
        rows,
    };
}

/**
 * Parses multiple CSV data blocks from content
 */
export function parseMultipleCSVData(content: string): {
    csvDataList: CSVData[];
    cleanedContent: string;
} {
    const csvDataList: CSVData[] = [];
    const csvRegex = /CSV_DATA_START\s*(.*?)\s*CSV_DATA_END/gs;
    let match;
    let cleanedContent = content;

    while ((match = csvRegex.exec(content)) !== null) {
        const csvContent = match[1].trim();
        const lines = csvContent.split("\n").filter((line) => line.trim());

        if (lines.length >= 2) {
            const headers = parseCSVLine(lines[0]);
            const rows = lines.slice(1).map((line) => parseCSVLine(line));

            csvDataList.push({
                headers,
                rows,
            });
        }

        // Remove the CSV block from the cleaned content
        cleanedContent = cleanedContent.replace(match[0], "");
    }

    return { csvDataList, cleanedContent: cleanedContent.trim() };
}

/**
 * Parses a single CSV line, handling quoted fields and commas
 */
function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                // Escaped quote
                current += '"';
                i += 2;
            } else {
                // Toggle quote state
                inQuotes = !inQuotes;
                i++;
            }
        } else if (char === "," && !inQuotes) {
            // Field separator
            result.push(current.trim());
            current = "";
            i++;
        } else {
            current += char;
            i++;
        }
    }

    // Add the last field
    result.push(current.trim());

    return result;
}

/**
 * Converts CSV data to a formatted string
 */
export function csvDataToString(csvData: CSVData): string {
    const lines = [csvData.headers.join(",")];
    csvData.rows.forEach((row) => {
        lines.push(row.join(","));
    });
    return lines.join("\n");
}

/**
 * Escapes CSV field content for proper formatting
 */
export function escapeCSVField(field: string): string {
    if (field.includes(",") || field.includes('"') || field.includes("\n")) {
        return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
}
