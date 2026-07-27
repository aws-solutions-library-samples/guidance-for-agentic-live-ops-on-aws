// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Box, Button, Header, Modal, SpaceBetween, Table } from "@cloudscape-design/components";

interface BreakdownsModalProps {
    visible: boolean;
    onDismiss: () => void;
    platformTotals: Record<string, number>;
    regionTotals: Record<string, number>;
    grandTotal: number;
}

export default function BreakdownsModal({
    visible,
    onDismiss,
    platformTotals,
    regionTotals,
    grandTotal,
}: BreakdownsModalProps) {
    return (
        <Modal
            visible={visible}
            onDismiss={onDismiss}
            header="Event Breakdowns"
            size="large"
            footer={
                <Box float="right">
                    <Button variant="primary" onClick={onDismiss}>
                        Close
                    </Button>
                </Box>
            }
        >
            <SpaceBetween direction="vertical" size="l">
                <Header variant="h3">By Platform</Header>
                <Table
                    items={Object.entries(platformTotals)
                        .map(([name, count]) => ({
                            name,
                            count,
                            pct: grandTotal > 0 ? ((count / grandTotal) * 100).toFixed(1) : "0",
                        }))
                        .sort((a, b) => b.count - a.count)}
                    columnDefinitions={[
                        { id: "name", header: "Platform", cell: (item) => item.name },
                        {
                            id: "count",
                            header: "Count",
                            cell: (item) => item.count.toLocaleString(),
                        },
                        { id: "pct", header: "%", cell: (item) => `${item.pct}%` },
                    ]}
                    variant="embedded"
                    sortingDisabled
                    empty="No platform data"
                />
                <Header variant="h3">By Region</Header>
                <Table
                    items={Object.entries(regionTotals)
                        .map(([name, count]) => ({
                            name,
                            count,
                            pct: grandTotal > 0 ? ((count / grandTotal) * 100).toFixed(1) : "0",
                        }))
                        .sort((a, b) => b.count - a.count)}
                    columnDefinitions={[
                        { id: "name", header: "Region", cell: (item) => item.name },
                        {
                            id: "count",
                            header: "Count",
                            cell: (item) => item.count.toLocaleString(),
                        },
                        { id: "pct", header: "%", cell: (item) => `${item.pct}%` },
                    ]}
                    variant="embedded"
                    sortingDisabled
                    empty="No region data"
                />
            </SpaceBetween>
        </Modal>
    );
}
