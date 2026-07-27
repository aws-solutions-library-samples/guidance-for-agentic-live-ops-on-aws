// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

import "../../common/styles/markdown.scss";
import "highlight.js/styles/github.css";

interface MarkdownRendererProps {
    content: string;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
    // Filter out unwanted knowledge base metadata text
    const cleanedContent = content.replace(
        /dont show this within the knoewloedge base frontend output/gi,
        ""
    );

    return (
        <div className="markdown-content">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{
                    // Custom components for better styling
                    h1: ({ children }) => <h1 className="markdown-h1">{children}</h1>,
                    h2: ({ children }) => <h2 className="markdown-h2">{children}</h2>,
                    h3: ({ children }) => <h3 className="markdown-h3">{children}</h3>,
                    h4: ({ children }) => <h4 className="markdown-h4">{children}</h4>,
                    h5: ({ children }) => <h5 className="markdown-h5">{children}</h5>,
                    h6: ({ children }) => <h6 className="markdown-h6">{children}</h6>,
                    p: ({ children }) => <p className="markdown-paragraph">{children}</p>,
                    ul: ({ children }) => <ul className="markdown-list">{children}</ul>,
                    ol: ({ children }) => (
                        <ol className="markdown-list markdown-ordered-list">{children}</ol>
                    ),
                    li: ({ children }) => <li className="markdown-list-item">{children}</li>,
                    code: ({ children, className, ...props }) => {
                        const isInline = !className;
                        return isInline ? (
                            <code className="markdown-inline-code" {...props}>
                                {children}
                            </code>
                        ) : (
                            <code className="markdown-code-block" {...props}>
                                {children}
                            </code>
                        );
                    },
                    pre: ({ children }) => <pre className="markdown-pre">{children}</pre>,
                    blockquote: ({ children }) => {
                        // Check if the blockquote contains knowledge base content
                        const childrenText = React.Children.toArray(children)
                            .map((child) => {
                                if (typeof child === "string") return child;
                                if (
                                    React.isValidElement(child) &&
                                    child.props &&
                                    typeof child.props === "object" &&
                                    child.props !== null &&
                                    "children" in child.props
                                ) {
                                    const childProps = child.props as { children?: unknown };
                                    return typeof childProps.children === "string"
                                        ? childProps.children
                                        : "";
                                }
                                return "";
                            })
                            .join(" ");

                        const isKbOutput =
                            childrenText.includes("Kb Operation") ||
                            childrenText.includes("Knowledge Base") ||
                            childrenText.includes("kb_operation") ||
                            childrenText.includes("Kb Status") ||
                            childrenText.includes("Results Count") ||
                            childrenText.includes("Kb ID");

                        return (
                            <blockquote
                                className={`markdown-blockquote ${isKbOutput ? "kb-output" : ""}`}
                            >
                                {children}
                            </blockquote>
                        );
                    },
                    a: ({ children, href, ...props }) => (
                        <a className="markdown-link" href={href} {...props}>
                            {children}
                        </a>
                    ),
                    strong: ({ children }) => (
                        <strong className="markdown-strong">{children}</strong>
                    ),
                    em: ({ children }) => <em className="markdown-emphasis">{children}</em>,
                    table: ({ children }) => <table className="markdown-table">{children}</table>,
                    thead: ({ children }) => (
                        <thead className="markdown-table-head">{children}</thead>
                    ),
                    tbody: ({ children }) => (
                        <tbody className="markdown-table-body">{children}</tbody>
                    ),
                    tr: ({ children }) => <tr className="markdown-table-row">{children}</tr>,
                    th: ({ children }) => <th className="markdown-table-header">{children}</th>,
                    td: ({ children }) => <td className="markdown-table-cell">{children}</td>,
                }}
            >
                {cleanedContent}
            </ReactMarkdown>
        </div>
    );
}
