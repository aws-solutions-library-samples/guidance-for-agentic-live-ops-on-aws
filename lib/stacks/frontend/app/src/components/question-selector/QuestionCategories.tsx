// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { QuestionCategory } from "./types";

interface QuestionCategoriesProps {
    categories: QuestionCategory[];
    selectedCategory: string | null;
    onCategorySelect: (agentType: string) => void;
}

export default function QuestionCategories({
    categories,
    selectedCategory,
    onCategorySelect,
}: QuestionCategoriesProps) {
    return (
        <Box padding="m">
            <Box fontSize="heading-s" margin={{ bottom: "m" }}>
                Agent Categories
            </Box>
            <SpaceBetween size="s">
                <Button
                    variant={selectedCategory === null ? "primary" : "normal"}
                    onClick={() => onCategorySelect("")}
                    fullWidth
                >
                    All Questions
                </Button>
                {categories.map((category) => (
                    <Button
                        key={category.agentType}
                        variant={selectedCategory === category.agentType ? "primary" : "normal"}
                        onClick={() => onCategorySelect(category.agentType)}
                        fullWidth
                    >
                        <SpaceBetween direction="horizontal" size="s" alignItems="center">
                            <span>{category.icon}</span>
                            <Box>
                                <Box fontSize="body-m">{category.name}</Box>
                                <Box fontSize="body-s" color="text-body-secondary">
                                    {category.questions.length} questions
                                </Box>
                            </Box>
                        </SpaceBetween>
                    </Button>
                ))}
            </SpaceBetween>
        </Box>
    );
}
