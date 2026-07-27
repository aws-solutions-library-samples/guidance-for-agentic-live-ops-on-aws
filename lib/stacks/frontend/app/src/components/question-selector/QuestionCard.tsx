// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { Question } from "./types";

interface QuestionCardProps {
    question: Question;
    onSelect: (questionText: string) => void;
}

export default function QuestionCard({ question, onSelect }: QuestionCardProps) {
    const handleSelect = () => {
        onSelect(question.text);
    };

    return (
        <Box padding="m" margin={{ bottom: "s" }}>
            <SpaceBetween size="s">
                <Box>
                    <Box fontSize="body-s" color="text-body-secondary" margin={{ bottom: "xs" }}>
                        {question.category}
                    </Box>
                    <Box fontSize="body-m">"{question.text}"</Box>
                </Box>

                {question.tags.length > 0 && (
                    <Box>
                        <SpaceBetween direction="horizontal" size="xs">
                            {question.tags.map((tag: string, index: number) => (
                                <Box
                                    key={index}
                                    padding={{ horizontal: "xs", vertical: "xxs" }}
                                    fontSize="body-s"
                                    color="text-status-info"
                                >
                                    {tag}
                                </Box>
                            ))}
                        </SpaceBetween>
                    </Box>
                )}

                <Box textAlign="right">
                    <Button
                        variant="primary"
                        onClick={handleSelect}
                        ariaLabel={`Use question: ${question.text}`}
                    >
                        Use This Question
                    </Button>
                </Box>
            </SpaceBetween>
        </Box>
    );
}
