// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { Question } from "./types";
import QuestionCard from "./QuestionCard";

interface QuestionListProps {
    questions: Question[];
    onQuestionSelect: (questionText: string) => void;
    selectedCategory: string | null;
}

export default function QuestionList({
    questions,
    onQuestionSelect,
    selectedCategory,
}: QuestionListProps) {
    const title = selectedCategory ? `Questions for: ${selectedCategory}` : "All Questions";

    if (questions.length === 0) {
        return (
            <Box padding="m" textAlign="center">
                <Box fontSize="heading-s" margin={{ bottom: "m" }}>
                    {title}
                </Box>
                <Box color="text-body-secondary">
                    No questions found. Try adjusting your search or category filter.
                </Box>
            </Box>
        );
    }

    return (
        <Box padding="m">
            <Box fontSize="heading-s" margin={{ bottom: "m" }}>
                {title} ({questions.length})
            </Box>
            <SpaceBetween size="s">
                {questions.map((question) => (
                    <QuestionCard
                        key={question.id}
                        question={question}
                        onSelect={onQuestionSelect}
                    />
                ))}
            </SpaceBetween>
        </Box>
    );
}
