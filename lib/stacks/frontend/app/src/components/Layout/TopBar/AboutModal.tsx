// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Box, Modal, SpaceBetween } from "@cloudscape-design/components";

interface AboutModalProps {
    visible: boolean;
    onDismiss: () => void;
    appName?: string;
}

const AboutModal = ({ visible, onDismiss, appName = "Demo" }: AboutModalProps) => {
    return (
        <Modal visible={visible} onDismiss={onDismiss} size="small" header={appName}>
            <SpaceBetween size="xxxs">
                <Box>Version: {import.meta.env.VITE_BUILD_VERSION}</Box>
                <Box variant={"small"}>
                    Updated: {new Date(import.meta.env.VITE_BUILD_TIMESTAMP).toLocaleString()}
                </Box>
                <Box>Stage: {import.meta.env.VITE_STAGE}</Box>
                <Box>Region: {import.meta.env.VITE_REGION}</Box>
            </SpaceBetween>
        </Modal>
    );
};

export default AboutModal;
