// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import Box from "@cloudscape-design/components/box";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";

interface SearchFilterProps {
    searchTerm: string;
    onSearchChange: (value: string) => void;
}

export default function SearchFilter({ searchTerm, onSearchChange }: SearchFilterProps) {
    return (
        <Box padding="m">
            <SpaceBetween size="s">
                <Box fontSize="heading-m">Agentic Live Ops Question Picker</Box>
                <Input
                    value={searchTerm}
                    onChange={({ detail }) => onSearchChange(detail.value)}
                    placeholder="Search questions..."
                    type="search"
                    clearAriaLabel="Clear search"
                />
                <Box fontSize="body-s" color="text-body-secondary">
                    Browse and select from curated questions to start targeted conversations with
                    the Agentic Live Ops system.
                </Box>
            </SpaceBetween>
        </Box>
    );
}
