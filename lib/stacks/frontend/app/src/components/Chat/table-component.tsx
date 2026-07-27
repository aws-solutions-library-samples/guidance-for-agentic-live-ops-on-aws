// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React from "react";
import Table from "@cloudscape-design/components/table";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { TableData } from "./table-parser";

interface TableComponentProps {
    tableData: TableData;
}

const TableComponent: React.FC<TableComponentProps> = ({ tableData }) => {
    const { title, headers, rows } = tableData;

    // Convert rows to objects for Cloudscape Table
    const items = rows.map((row, index) => {
        const item: Record<string, string | number> = { id: index };
        headers.forEach((header, headerIndex) => {
            item[header] = row[headerIndex] || "";
        });
        return item;
    });

    // Create column definitions
    const columnDefinitions = headers.map((header) => ({
        id: header,
        header: header,
        cell: (item: Record<string, string | number>) => item[header] || "",
        sortingField: header,
        isRowHeader: header === headers[0], // First column as row header
    }));

    const handleDownloadCSV = () => {
        const csvContent =
            headers.join(",") +
            "\n" +
            rows
                .map((row) =>
                    row
                        .map((cell) =>
                            cell.includes(",") || cell.includes('"')
                                ? `"${cell.replace(/"/g, '""')}"`
                                : cell
                        )
                        .join(",")
                )
                .join("\n");

        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.download = `${title || "table"}.csv`;
        link.href = URL.createObjectURL(blob);
        link.click();
        URL.revokeObjectURL(link.href);
    };

    return (
        <Container
            header={
                <Header
                    variant="h3"
                    actions={
                        <SpaceBetween direction="horizontal" size="xs">
                            <Button
                                variant="normal"
                                iconName="download"
                                onClick={handleDownloadCSV}
                                ariaLabel={`Download ${title} as CSV`}
                            >
                                Download CSV
                            </Button>
                        </SpaceBetween>
                    }
                >
                    {title}
                </Header>
            }
        >
            <Box padding="s">
                <Table
                    columnDefinitions={columnDefinitions}
                    items={items}
                    sortingDisabled={false}
                    variant="embedded"
                    resizableColumns={true}
                    stickyHeader={true}
                    stripedRows={true}
                    wrapLines={false}
                    empty={
                        <Box margin={{ vertical: "xs" }} textAlign="center" color="inherit">
                            <b>No data available</b>
                        </Box>
                    }
                    ariaLabels={{
                        selectionGroupLabel: "Items selection",
                        allItemsSelectionLabel: ({ selectedItems }) =>
                            `${selectedItems.length} ${
                                selectedItems.length === 1 ? "item" : "items"
                            } selected`,
                        itemSelectionLabel: ({ selectedItems }, item) => {
                            const isItemSelected = selectedItems.filter(
                                (i) => i.id === item.id
                            ).length;
                            return `${item[headers[0]] || `Row ${Number(item.id) + 1}`} is ${
                                isItemSelected ? "" : "not "
                            }selected`;
                        },
                    }}
                />
            </Box>
        </Container>
    );
};

export default TableComponent;
