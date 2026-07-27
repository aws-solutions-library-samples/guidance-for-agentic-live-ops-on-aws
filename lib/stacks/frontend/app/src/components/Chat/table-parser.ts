// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export interface TableData {
    headers: string[];
    rows: string[][];
    title?: string;
}

/**
 * Checks if content contains TABLE_DATA markers
 */
export function contentHasTableData(content: string): boolean {
    return content.includes("TABLE_DATA:") && content.includes("END_TABLE_DATA");
}

/**
 * Parses TABLE_DATA from content with TABLE_DATA: and END_TABLE_DATA markers
 */
export function parseTableData(content: string): TableData | null {
    const tableMatch = content.match(/TABLE_DATA:\s*(.*?)\s*END_TABLE_DATA/s);
    if (!tableMatch) return null;

    const tableContent = tableMatch[1].trim();
    const lines = tableContent.split("\n").filter((line) => line.trim());

    if (lines.length < 2) return null;

    let title: string | undefined;
    let headers: string[] = [];
    const rows: string[][] = [];
    let headersParsed = false;

    for (const line of lines) {
        const trimmedLine = line.trim();

        // Skip metadata lines (they start with "Metadata:")
        if (trimmedLine.startsWith("Metadata:")) {
            continue;
        }

        // Handle title line
        if (trimmedLine.startsWith("Title:")) {
            title = trimmedLine.substring(6).trim();
            continue;
        }

        // Handle headers line
        if (trimmedLine.startsWith("Headers:")) {
            headers = parseTableLine(trimmedLine.substring(8).trim());
            headersParsed = true;
            continue;
        }

        // Handle row lines
        if (trimmedLine.startsWith("Row:")) {
            const rowData = parseTableLine(trimmedLine.substring(4).trim());
            rows.push(rowData);
            continue;
        }

        // If no special prefixes and we haven't parsed headers yet, treat as headers
        if (!headersParsed) {
            headers = parseTableLine(trimmedLine);
            headersParsed = true;
        } else {
            // Otherwise treat as a data row
            rows.push(parseTableLine(trimmedLine));
        }
    }

    if (headers.length === 0 || rows.length === 0) return null;

    return {
        headers,
        rows,
        title,
    };
}

/**
 * Parses multiple TABLE_DATA blocks from content
 */
export function parseMultipleTableData(content: string): {
    tableDataList: TableData[];
    cleanedContent: string;
} {
    const tableDataList: TableData[] = [];
    const tableRegex = /TABLE_DATA:\s*(.*?)\s*END_TABLE_DATA/gs;
    let match;
    let cleanedContent = content;

    while ((match = tableRegex.exec(content)) !== null) {
        const tableContent = match[1].trim();
        const lines = tableContent.split("\n").filter((line) => line.trim());

        if (lines.length >= 2) {
            let title: string | undefined;
            let headers: string[] = [];
            const rows: string[][] = [];
            let headersParsed = false;

            for (const line of lines) {
                const trimmedLine = line.trim();

                // Skip metadata lines (they start with "Metadata:")
                if (trimmedLine.startsWith("Metadata:")) {
                    continue;
                }

                // Handle title line
                if (trimmedLine.startsWith("Title:")) {
                    title = trimmedLine.substring(6).trim();
                    continue;
                }

                // Handle headers line
                if (trimmedLine.startsWith("Headers:")) {
                    headers = parseTableLine(trimmedLine.substring(8).trim());
                    headersParsed = true;
                    continue;
                }

                // Handle row lines
                if (trimmedLine.startsWith("Row:")) {
                    const rowData = parseTableLine(trimmedLine.substring(4).trim());
                    rows.push(rowData);
                    continue;
                }

                // If no special prefixes and we haven't parsed headers yet, treat as headers
                if (!headersParsed) {
                    headers = parseTableLine(trimmedLine);
                    headersParsed = true;
                } else {
                    // Otherwise treat as a data row
                    rows.push(parseTableLine(trimmedLine));
                }
            }

            if (headers.length > 0 && rows.length > 0) {
                tableDataList.push({
                    headers,
                    rows,
                    title,
                });
            }
        }

        // Remove the TABLE_DATA block from the cleaned content
        cleanedContent = cleanedContent.replace(match[0], "");
    }

    return { tableDataList, cleanedContent: cleanedContent.trim() };
}

/**
 * Parses a single table line, handling various separators (|, tab, multiple spaces)
 */
function parseTableLine(line: string): string[] {
    // Remove leading/trailing whitespace
    line = line.trim();

    // Handle pipe-separated values (common in markdown tables)
    if (line.includes("|")) {
        return line
            .split("|")
            .map((cell) => cell.trim())
            .filter((cell) => cell !== ""); // Remove empty cells from leading/trailing pipes
    }

    // Handle tab-separated values
    if (line.includes("\t")) {
        return line.split("\t").map((cell) => cell.trim());
    }

    // Handle multiple spaces as separators (2+ spaces)
    if (line.match(/\s{2,}/)) {
        return line.split(/\s{2,}/).map((cell) => cell.trim());
    }

    // Handle comma-separated values as fallback
    if (line.includes(",")) {
        return line.split(",").map((cell) => cell.trim());
    }

    // If no clear separator, treat as single cell
    return [line];
}

/**
 * Converts table data to a formatted string
 */
export function tableDataToString(tableData: TableData): string {
    const lines = [tableData.headers.join(" | ")];
    tableData.rows.forEach((row) => {
        lines.push(row.join(" | "));
    });
    return lines.join("\n");
}
