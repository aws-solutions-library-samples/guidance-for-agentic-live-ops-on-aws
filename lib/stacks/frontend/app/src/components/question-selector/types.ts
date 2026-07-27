// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export interface Question {
    id: string;
    text: string;
    category: string;
    agentType: string;
    tags: string[];
    description?: string;
}

export interface QuestionCategory {
    name: string;
    agentType: string;
    icon: string;
    description: string;
    questions: Question[];
}

export interface QuestionSelectorProps {
    onQuestionSelect: (question: string) => void;
    isVisible: boolean;
    onClose: () => void;
}
