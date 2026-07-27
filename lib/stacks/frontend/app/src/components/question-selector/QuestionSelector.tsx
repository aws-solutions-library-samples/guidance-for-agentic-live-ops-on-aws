// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useState, useMemo } from "react";
import Modal from "@cloudscape-design/components/modal";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Container from "@cloudscape-design/components/container";
import { QuestionSelectorProps, Question, QuestionCategory } from "./types";
import { parseQuestionsFromMarkdown, filterQuestionsByCategory } from "./question-parser";
import SearchFilter from "./SearchFilter";
import QuestionCategories from "./QuestionCategories";
import QuestionList from "./QuestionList";
import "../../common/styles/question-selector.scss";

export default function QuestionSelector({
    onQuestionSelect,
    isVisible,
    onClose,
}: QuestionSelectorProps) {
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

    // Parse questions from markdown data
    const categories: QuestionCategory[] = useMemo(() => {
        return parseQuestionsFromMarkdown();
    }, []);

    // Filter questions based on search and category
    const filteredQuestions: Question[] = useMemo(() => {
        let questions: Question[] = [];

        if (selectedCategory) {
            // Get questions for selected category
            questions = filterQuestionsByCategory(categories, selectedCategory);
        } else {
            // Get all questions
            questions = categories.flatMap((category) => category.questions);
        }

        // Apply search filter
        if (searchTerm.trim()) {
            questions = questions.filter(
                (question) =>
                    question.text.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    question.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    question.agentType.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    question.tags.some((tag: string) =>
                        tag.toLowerCase().includes(searchTerm.toLowerCase())
                    )
            );
        }

        return questions;
    }, [categories, selectedCategory, searchTerm]);

    const handleQuestionSelect = (questionText: string) => {
        onQuestionSelect(questionText);
        onClose();
    };

    const handleCategorySelect = (agentType: string) => {
        setSelectedCategory(agentType || null);
    };

    const handleSearchChange = (value: string) => {
        setSearchTerm(value);
    };

    return (
        <Modal
            onDismiss={onClose}
            visible={isVisible}
            size="large"
            header="Gaming Intelligence Question Selector"
            footer={
                <Box float="right">
                    <Button variant="link" onClick={onClose}>
                        Cancel
                    </Button>
                </Box>
            }
        >
            <Container>
                <SearchFilter searchTerm={searchTerm} onSearchChange={handleSearchChange} />

                <ColumnLayout columns={2} variant="text-grid">
                    <QuestionCategories
                        categories={categories}
                        selectedCategory={selectedCategory}
                        onCategorySelect={handleCategorySelect}
                    />

                    <QuestionList
                        questions={filteredQuestions}
                        onQuestionSelect={handleQuestionSelect}
                        selectedCategory={selectedCategory}
                    />
                </ColumnLayout>
            </Container>
        </Modal>
    );
}
