// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Box, Button, ColumnLayout, Container } from "@cloudscape-design/components";

interface KpiCardsProps {
    grandTotal: number;
    platformTotals: Record<string, number>;
    regionTotals: Record<string, number>;
    reportCount: number;
    onShowBreakdowns: () => void;
}

export default function KpiCards({
    grandTotal,
    platformTotals,
    regionTotals,
    reportCount,
    onShowBreakdowns,
}: KpiCardsProps) {
    return (
        <ColumnLayout columns={4} variant="text-grid">
            <Container>
                <Box variant="awsui-key-label">Total Events</Box>
                <Box variant="h2">{grandTotal.toLocaleString()}</Box>
            </Container>
            <Container>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "start",
                    }}
                >
                    <div>
                        <Box variant="awsui-key-label">Devices</Box>
                        <Box variant="h2">
                            {Object.values(platformTotals)
                                .reduce((a, b) => a + b, 0)
                                .toLocaleString()}
                        </Box>
                    </div>
                    <Button
                        variant="icon"
                        iconName="view-full"
                        onClick={onShowBreakdowns}
                        ariaLabel="View device details"
                    />
                </div>
            </Container>
            <Container>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "start",
                    }}
                >
                    <div>
                        <Box variant="awsui-key-label">Regions</Box>
                        <Box variant="h2">{Object.keys(regionTotals).length}</Box>
                    </div>
                    <Button
                        variant="icon"
                        iconName="view-full"
                        onClick={onShowBreakdowns}
                        ariaLabel="View region details"
                    />
                </div>
            </Container>
            <Container>
                <Box variant="awsui-key-label">Reports</Box>
                <Box variant="h2">{reportCount}</Box>
            </Container>
        </ColumnLayout>
    );
}
