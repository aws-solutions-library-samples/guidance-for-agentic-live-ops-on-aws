# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Unit tests for LLM output parsing and validation functions (task 5.3)."""

import sys

# Ensure the schema package is importable without boto3/powertools at import time
# by mocking heavy AWS dependencies before importing the module under test.
from unittest.mock import MagicMock

sys.modules.setdefault("boto3", MagicMock())
sys.modules.setdefault("aws_lambda_powertools", MagicMock())

# Now import the functions under test
from index import (  # noqa: E402
    parse_llm_output,
    _extract_table_name,
    _validate_and_repair_doc,
    _validate_columns_table,
    validate_docs,
)


# ---------------------------------------------------------------------------
# parse_llm_output
# ---------------------------------------------------------------------------


class TestParseLlmOutput:
    def test_single_doc_no_delimiter(self):
        raw = "# Table: orders\n## Description\nOrders table."
        result = parse_llm_output(raw)
        assert len(result) == 1
        assert "orders" in result[0]

    def test_two_docs_split(self):
        raw = "# Table: a\ncontent a\n---SPLIT---\n# Table: b\ncontent b"
        result = parse_llm_output(raw)
        assert len(result) == 2
        assert "a" in result[0]
        assert "b" in result[1]

    def test_three_delimiters_four_docs(self):
        raw = "doc1\n---SPLIT---\ndoc2\n---SPLIT---\ndoc3\n---SPLIT---\ndoc4"
        result = parse_llm_output(raw)
        assert len(result) == 4

    def test_empty_segments_filtered(self):
        raw = "---SPLIT---\n\n---SPLIT---\ndoc1\n---SPLIT---\n  \n---SPLIT---\ndoc2"
        result = parse_llm_output(raw)
        assert len(result) == 2

    def test_empty_input(self):
        assert parse_llm_output("") == []
        assert parse_llm_output("   ") == []

    def test_whitespace_stripped(self):
        raw = "  \n  doc1  \n  \n---SPLIT---\n  doc2  \n  "
        result = parse_llm_output(raw)
        assert result[0] == "doc1"
        assert result[1] == "doc2"


# ---------------------------------------------------------------------------
# _extract_table_name
# ---------------------------------------------------------------------------


class TestExtractTableName:
    def test_simple_table_name(self):
        doc = "# Table: orders\n## Description\nSome text"
        assert _extract_table_name(doc) == "orders"

    def test_dotted_table_name(self):
        doc = "# Table: warehouse_a.public.orders\n## Description\nSome text"
        assert _extract_table_name(doc) == "orders"

    def test_no_table_header_returns_fallback(self):
        doc = "## Description\nSome text without a table header"
        name = _extract_table_name(doc)
        assert name.startswith("unknown_table_")

    def test_table_name_with_extra_spaces(self):
        doc = "# Table:   my_table  \n## Description"
        assert _extract_table_name(doc) == "my_table"


# ---------------------------------------------------------------------------
# _validate_and_repair_doc
# ---------------------------------------------------------------------------


class TestValidateAndRepairDoc:
    def _complete_doc(self):
        return (
            "# Table: orders\n\n"
            "## Description\nOrders table.\n\n"
            "## Columns\n| Column | Type | Nullable | Description | Business Term |\n"
            "|--------|------|----------|-------------|---------------|\n"
            "| id | INT | NO | Primary key | Order ID |\n\n"
            "## Relationships\nNo foreign keys detected.\n\n"
            "## Glossary\nNo glossary entries.\n\n"
            "## Notes\nSome notes."
        )

    def test_complete_doc_no_issues(self):
        doc = self._complete_doc()
        repaired, issues = _validate_and_repair_doc(doc)
        assert issues == []
        assert repaired == doc

    def test_missing_description_added(self):
        doc = "# Table: orders\n\n## Columns\n| Column |\n\n## Relationships\nNone\n\n## Glossary\nNone\n\n## Notes\nNone"
        repaired, issues = _validate_and_repair_doc(doc)
        assert "Missing section: Description" in issues
        assert "## Description" in repaired
        assert "<!-- TODO: verify description -->" in repaired

    def test_missing_columns_added(self):
        doc = "# Table: orders\n\n## Description\nText\n\n## Relationships\nNone\n\n## Glossary\nNone\n\n## Notes\nNone"
        repaired, issues = _validate_and_repair_doc(doc)
        assert "Missing section: Columns" in issues
        assert "## Columns" in repaired
        assert "<!-- TODO: add columns -->" in repaired
        assert "| Column | Type | Nullable | Description | Business Term |" in repaired

    def test_missing_relationships_added(self):
        doc = "# Table: orders\n\n## Description\nText\n\n## Columns\n| Column |\n\n## Glossary\nNone\n\n## Notes\nNone"
        repaired, issues = _validate_and_repair_doc(doc)
        assert "Missing section: Relationships" in issues
        assert "No foreign keys detected." in repaired

    def test_missing_glossary_added(self):
        doc = "# Table: orders\n\n## Description\nText\n\n## Columns\n| Column |\n\n## Relationships\nNone\n\n## Notes\nNone"
        repaired, issues = _validate_and_repair_doc(doc)
        assert "Missing section: Glossary" in issues
        assert "No glossary entries." in repaired

    def test_missing_notes_added(self):
        doc = "# Table: orders\n\n## Description\nText\n\n## Columns\n| Column |\n\n## Relationships\nNone\n\n## Glossary\nNone"
        repaired, issues = _validate_and_repair_doc(doc)
        assert "Missing section: Notes" in issues
        assert "## Notes" in repaired
        assert "<!-- TODO: Add any business context" in repaired

    def test_all_sections_missing(self):
        doc = "# Table: orders"
        repaired, issues = _validate_and_repair_doc(doc)
        assert len(issues) == 5
        for section in ["Description", "Columns", "Relationships", "Glossary", "Notes"]:
            assert f"Missing section: {section}" in issues
            assert f"## {section}" in repaired

    def test_case_insensitive_heading_match(self):
        doc = (
            "# Table: orders\n\n"
            "## description\nText\n\n"
            "## COLUMNS\n| Column |\n\n"
            "## Relationships\nNone\n\n"
            "## glossary\nNone\n\n"
            "## NOTES\nNone"
        )
        repaired, issues = _validate_and_repair_doc(doc)
        assert issues == []


# ---------------------------------------------------------------------------
# _validate_columns_table
# ---------------------------------------------------------------------------


class TestValidateColumnsTable:
    def test_correct_headers_no_issues(self):
        doc = (
            "## Columns\n"
            "| Column | Type | Nullable | Description | Business Term |\n"
            "|--------|------|----------|-------------|---------------|\n"
            "| id | INT | NO | Primary key | Order ID |\n"
        )
        repaired, issues = _validate_columns_table(doc)
        assert issues == []

    def test_no_columns_section_no_issues(self):
        doc = "## Description\nSome text"
        repaired, issues = _validate_columns_table(doc)
        assert issues == []

    def test_columns_section_no_table(self):
        doc = "## Columns\nSome text but no table\n\n## Relationships\nNone"
        repaired, issues = _validate_columns_table(doc)
        assert len(issues) == 1
        assert "no markdown table" in issues[0]
        assert "| Column | Type | Nullable | Description | Business Term |" in repaired

    def test_wrong_headers_repaired(self):
        doc = (
            "## Columns\n"
            "| Name | DataType | Null | Desc |\n"
            "|------|----------|------|------|\n"
            "| id | INT | NO | Primary key |\n"
        )
        repaired, issues = _validate_columns_table(doc)
        assert len(issues) == 1
        assert "wrong headers" in issues[0]
        assert "| Column | Type | Nullable | Description | Business Term |" in repaired
        # Data row should be preserved
        assert "| id | INT | NO | Primary key |" in repaired


# ---------------------------------------------------------------------------
# validate_docs (orchestrator)
# ---------------------------------------------------------------------------


class TestValidateDocs:
    def test_single_complete_doc(self):
        raw = (
            "# Table: warehouse_a.public.orders\n\n"
            "## Description\nOrders table.\n\n"
            "## Columns\n"
            "| Column | Type | Nullable | Description | Business Term |\n"
            "|--------|------|----------|-------------|---------------|\n"
            "| id | INT | NO | Primary key | Order ID |\n\n"
            "## Relationships\nNo foreign keys detected.\n\n"
            "## Glossary\nNo glossary entries.\n\n"
            "## Notes\nSome notes."
        )
        docs, warnings = validate_docs(raw)
        assert len(docs) == 1
        assert docs[0]["table_name"] == "orders"
        assert docs[0]["has_todos"] is False
        assert warnings == []

    def test_multiple_docs_with_split(self):
        doc_a = (
            "# Table: orders\n\n"
            "## Description\nOrders.\n\n"
            "## Columns\n| Column | Type | Nullable | Description | Business Term |\n"
            "|--------|------|----------|-------------|---------------|\n\n"
            "## Relationships\nNone\n\n## Glossary\nNone\n\n## Notes\nNone"
        )
        doc_b = (
            "# Table: customers\n\n"
            "## Description\nCustomers.\n\n"
            "## Columns\n| Column | Type | Nullable | Description | Business Term |\n"
            "|--------|------|----------|-------------|---------------|\n\n"
            "## Relationships\nNone\n\n## Glossary\nNone\n\n## Notes\nNone"
        )
        raw = f"{doc_a}\n---SPLIT---\n{doc_b}"
        docs, warnings = validate_docs(raw)
        assert len(docs) == 2
        assert docs[0]["table_name"] == "orders"
        assert docs[1]["table_name"] == "customers"

    def test_doc_with_todos_detected(self):
        raw = (
            "# Table: orders\n\n"
            "## Description\n<!-- TODO: verify description -->\n\n"
            "## Columns\n| Column | Type | Nullable | Description | Business Term |\n"
            "|--------|------|----------|-------------|---------------|\n\n"
            "## Relationships\nNone\n\n## Glossary\nNone\n\n## Notes\nNone"
        )
        docs, warnings = validate_docs(raw)
        assert docs[0]["has_todos"] is True

    def test_missing_sections_repaired_and_warned(self):
        raw = "# Table: orders\n\n## Description\nOrders."
        docs, warnings = validate_docs(raw)
        assert len(docs) == 1
        assert docs[0]["table_name"] == "orders"
        # Should have warnings for missing Columns, Relationships, Glossary, Notes
        assert len(warnings) >= 4
        # Repaired doc should have all sections
        content = docs[0]["content"]
        for section in ["Description", "Columns", "Relationships", "Glossary", "Notes"]:
            assert f"## {section}" in content
        # Missing sections get TODOs, so has_todos should be True
        assert docs[0]["has_todos"] is True

    def test_unknown_table_counter_resets(self):
        raw = "no table header here\n---SPLIT---\nalso no header"
        docs, _ = validate_docs(raw)
        assert docs[0]["table_name"] == "unknown_table_1"
        assert docs[1]["table_name"] == "unknown_table_2"
        # Call again — counter should reset
        docs2, _ = validate_docs(raw)
        assert docs2[0]["table_name"] == "unknown_table_1"
