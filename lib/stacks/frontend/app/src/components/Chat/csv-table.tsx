// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import Table from "@cloudscape-design/components/table";
import Header from "@cloudscape-design/components/header";
import Box from "@cloudscape-design/components/box";
import { CSVData } from "./csv-parser";

interface CSVTableProps {
    csvData: CSVData;
    title?: string;
}

export default function CSVTable({ csvData, title }: CSVTableProps) {
    if (!csvData || !csvData.headers || !csvData.rows) {
        return null;
    }

    // Create column definitions from headers
    const columnDefinitions = csvData.headers.map((header, index) => ({
        id: `col-${index}`,
        header: header,
        cell: (item: Record<string, unknown>) => (item[`col-${index}`] as string) || "",
        sortingField: `col-${index}`,
        isRowHeader: index === 0,
    }));

    // Transform rows into items for the table
    const items = csvData.rows.map((row, rowIndex) => {
        const item: Record<string, unknown> = { id: rowIndex };
        row.forEach((cell, cellIndex) => {
            item[`col-${cellIndex}`] = cell;
        });
        return item;
    });

    return (
        <Box margin={{ vertical: "m" }}>
            <Table
                columnDefinitions={columnDefinitions}
                items={items}
                loadingText="Loading data"
                sortingDisabled={false}
                empty={
                    <Box textAlign="center" color="inherit">
                        <b>No data available</b>
                        <Box padding={{ bottom: "s" }} variant="p" color="inherit">
                            No data to display in this table.
                        </Box>
                    </Box>
                }
                header={
                    title ? (
                        <Header
                            counter={`(${items.length})`}
                            description="Data table generated from CSV content"
                        >
                            {title}
                        </Header>
                    ) : (
                        <Header
                            counter={`(${items.length})`}
                            description="Data table generated from CSV content"
                        >
                            Data Table
                        </Header>
                    )
                }
            />
        </Box>
    );
}
