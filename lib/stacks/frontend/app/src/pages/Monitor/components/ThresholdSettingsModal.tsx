// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Box, Button, Checkbox, Input, Modal, SpaceBetween } from "@cloudscape-design/components";

interface ThresholdSettingsModalProps {
    editingMetric: string | null;
    editValue: string;
    editAutoReport: boolean;
    onEditValueChange: (value: string) => void;
    onEditAutoReportChange: (checked: boolean) => void;
    onSave: () => void;
    onDismiss: () => void;
}

export default function ThresholdSettingsModal({
    editingMetric,
    editValue,
    editAutoReport,
    onEditValueChange,
    onEditAutoReportChange,
    onSave,
    onDismiss,
}: ThresholdSettingsModalProps) {
    if (!editingMetric) return null;

    return (
        <Modal
            visible={!!editingMetric}
            onDismiss={onDismiss}
            header={`Configure: ${editingMetric.replace(/_/g, " ")}`}
            footer={
                <Box float="right">
                    <SpaceBetween direction="horizontal" size="xs">
                        <Button variant="link" onClick={onDismiss}>
                            Cancel
                        </Button>
                        <Button variant="primary" onClick={onSave}>
                            Save
                        </Button>
                    </SpaceBetween>
                </Box>
            }
        >
            <SpaceBetween direction="vertical" size="m">
                <div>
                    <Box variant="awsui-key-label">Threshold</Box>
                    <Input
                        type="number"
                        value={editValue}
                        onChange={({ detail }) => onEditValueChange(detail.value)}
                    />
                    <Box variant="small" color="text-body-secondary">
                        Alert triggers when event count exceeds this value within the monitoring
                        window.
                    </Box>
                </div>
                <Checkbox
                    checked={editAutoReport}
                    onChange={({ detail }) => onEditAutoReportChange(detail.checked)}
                >
                    Auto-generate report when threshold is breached
                </Checkbox>
                <Box variant="small" color="text-body-secondary">
                    When enabled, an AI analysis report will be automatically created when this
                    metric exceeds the threshold.
                </Box>
            </SpaceBetween>
        </Modal>
    );
}
