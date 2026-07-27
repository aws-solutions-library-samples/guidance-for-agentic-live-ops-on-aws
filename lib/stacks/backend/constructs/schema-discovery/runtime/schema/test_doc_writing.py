# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Unit tests for doc writing and manifest generation (task 5.8)."""

import json
import sys
from unittest.mock import MagicMock, patch

# Mock heavy AWS dependencies before importing the module under test.
sys.modules.setdefault("boto3", MagicMock())
sys.modules.setdefault("aws_lambda_powertools", MagicMock())

import index as schema  # noqa: E402
from index import _write_doc_to_s3, _write_manifest, generate_schema_docs  # noqa: E402


class TestWriteDocToS3:
    def test_writes_correct_key_and_content(self):
        mock_s3 = MagicMock()
        with (
            patch.object(schema, "s3", mock_s3),
            patch.object(schema, "DOCS_BUCKET", "my-docs-bucket"),
        ):
            _write_doc_to_s3("warehouse_a", "orders", "# Table: orders\ncontent")

        mock_s3.put_object.assert_called_once_with(
            Bucket="my-docs-bucket",
            Key="warehouse_a/orders.md",
            Body=b"# Table: orders\ncontent",
            ContentType="text/markdown",
        )

    def test_content_type_is_text_markdown(self):
        mock_s3 = MagicMock()
        with (
            patch.object(schema, "s3", mock_s3),
            patch.object(schema, "DOCS_BUCKET", "bucket"),
        ):
            _write_doc_to_s3("store", "tbl", "doc content")

        _, kwargs = mock_s3.put_object.call_args
        assert kwargs["ContentType"] == "text/markdown"

    def test_key_format(self):
        mock_s3 = MagicMock()
        with (
            patch.object(schema, "s3", mock_s3),
            patch.object(schema, "DOCS_BUCKET", "bucket"),
        ):
            _write_doc_to_s3("my_store", "my_table", "content")

        _, kwargs = mock_s3.put_object.call_args
        assert kwargs["Key"] == "my_store/my_table.md"


class TestWriteManifest:
    def test_manifest_structure(self):
        mock_s3 = MagicMock()
        docs = [
            {"table_name": "orders", "content": "...", "has_todos": True},
            {"table_name": "customers", "content": "...", "has_todos": False},
            {"table_name": "products", "content": "...", "has_todos": True},
        ]
        with (
            patch.object(schema, "s3", mock_s3),
            patch.object(schema, "DOCS_BUCKET", "docs-bucket"),
        ):
            key = _write_manifest(
                "warehouse_a", ["columns.csv", "ddl.sql"], docs, ["a warning"]
            )

        assert key == "warehouse_a/_manifest.json"
        mock_s3.put_object.assert_called_once()
        _, kwargs = mock_s3.put_object.call_args
        assert kwargs["Bucket"] == "docs-bucket"
        assert kwargs["Key"] == "warehouse_a/_manifest.json"
        assert kwargs["ContentType"] == "application/json"

        manifest = json.loads(kwargs["Body"].decode("utf-8"))
        assert manifest["store_name"] == "warehouse_a"
        assert manifest["source_files"] == ["columns.csv", "ddl.sql"]
        assert manifest["tables_generated"] == 3
        assert manifest["tables_with_todos"] == 2
        assert manifest["warnings"] == ["a warning"]
        assert "processed_at" in manifest

    def test_manifest_tables_generated_equals_doc_count(self):
        mock_s3 = MagicMock()
        docs = [
            {"table_name": f"t{i}", "content": "...", "has_todos": False}
            for i in range(5)
        ]
        with (
            patch.object(schema, "s3", mock_s3),
            patch.object(schema, "DOCS_BUCKET", "bucket"),
        ):
            _write_manifest("store", ["f.csv"], docs, [])

        manifest = json.loads(mock_s3.put_object.call_args[1]["Body"].decode("utf-8"))
        assert manifest["tables_generated"] == 5

    def test_manifest_zero_todos(self):
        mock_s3 = MagicMock()
        docs = [{"table_name": "t1", "content": "...", "has_todos": False}]
        with (
            patch.object(schema, "s3", mock_s3),
            patch.object(schema, "DOCS_BUCKET", "bucket"),
        ):
            _write_manifest("store", ["f.csv"], docs, [])

        manifest = json.loads(mock_s3.put_object.call_args[1]["Body"].decode("utf-8"))
        assert manifest["tables_with_todos"] == 0

    def test_manifest_content_type_is_json(self):
        mock_s3 = MagicMock()
        with (
            patch.object(schema, "s3", mock_s3),
            patch.object(schema, "DOCS_BUCKET", "bucket"),
        ):
            _write_manifest("store", [], [], [])

        _, kwargs = mock_s3.put_object.call_args
        assert kwargs["ContentType"] == "application/json"


class TestGenerateSchemaDocsIntegration:
    """Test the updated generate_schema_docs writes docs and manifest to S3."""

    def _make_complete_llm_output(self, table_names: list[str]) -> str:
        docs = []
        for name in table_names:
            docs.append(
                f"# Table: {name}\n\n"
                f"## Description\n{name} table.\n\n"
                "## Columns\n"
                "| Column | Type | Nullable | Description | Business Term |\n"
                "|--------|------|----------|-------------|---------------|\n"
                "| id | INT | NO | Primary key | ID |\n\n"
                "## Relationships\nNo foreign keys detected.\n\n"
                "## Glossary\nNo glossary entries.\n\n"
                "## Notes\nSome notes."
            )
        return "\n---SPLIT---\n".join(docs)

    def test_writes_docs_and_manifest(self):
        mock_s3 = MagicMock()
        # _read_file returns content for each key
        mock_s3.head_object.return_value = {"ContentLength": 100}
        mock_s3.get_object.return_value = {
            "Body": MagicMock(read=lambda: b"CREATE TABLE orders (id INT);")
        }

        llm_output = self._make_complete_llm_output(["orders", "customers"])

        with (
            patch.object(schema, "s3", mock_s3),
            patch.object(schema, "DOCS_BUCKET", "docs-bucket"),
            patch.object(schema, "_generate_with_llm", return_value=llm_output),
        ):
            result = generate_schema_docs(
                "raw-bucket", "warehouse_a", ["warehouse_a/ddl.sql"]
            )

        assert result["docs_generated"] == 2
        assert result["output_prefix"] == "warehouse_a/"
        assert result["manifest_key"] == "warehouse_a/_manifest.json"

        # Verify put_object was called for each doc + manifest = 3 calls
        put_calls = mock_s3.put_object.call_args_list
        assert len(put_calls) == 3

        # Check doc keys
        doc_keys = [c[1]["Key"] for c in put_calls]
        assert "warehouse_a/orders.md" in doc_keys
        assert "warehouse_a/customers.md" in doc_keys
        assert "warehouse_a/_manifest.json" in doc_keys

    def test_source_files_are_filenames_only(self):
        mock_s3 = MagicMock()
        mock_s3.head_object.return_value = {"ContentLength": 50}
        mock_s3.get_object.return_value = {
            "Body": MagicMock(read=lambda: b"CREATE TABLE t1 (id INT);")
        }

        llm_output = self._make_complete_llm_output(["t1"])

        with (
            patch.object(schema, "s3", mock_s3),
            patch.object(schema, "DOCS_BUCKET", "docs-bucket"),
            patch.object(schema, "_generate_with_llm", return_value=llm_output),
        ):
            generate_schema_docs(
                "raw-bucket",
                "warehouse_a",
                ["warehouse_a/columns.csv", "warehouse_a/ddl.sql"],
            )

        # Find the manifest put_object call
        manifest_call = [
            c
            for c in mock_s3.put_object.call_args_list
            if c[1]["Key"].endswith("_manifest.json")
        ][0]
        manifest = json.loads(manifest_call[1]["Body"].decode("utf-8"))
        assert manifest["source_files"] == ["columns.csv", "ddl.sql"]

    def test_manifest_tables_generated_matches_docs_written(self):
        mock_s3 = MagicMock()
        mock_s3.head_object.return_value = {"ContentLength": 50}
        mock_s3.get_object.return_value = {
            "Body": MagicMock(read=lambda: b"CREATE TABLE a (id INT);")
        }

        llm_output = self._make_complete_llm_output(["a", "b", "c"])

        with (
            patch.object(schema, "s3", mock_s3),
            patch.object(schema, "DOCS_BUCKET", "docs-bucket"),
            patch.object(schema, "_generate_with_llm", return_value=llm_output),
        ):
            result = generate_schema_docs(
                "raw-bucket", "store_x", ["store_x/schema.sql"]
            )

        assert result["docs_generated"] == 3

        # Count .md files written (exclude manifest)
        md_calls = [
            c for c in mock_s3.put_object.call_args_list if c[1]["Key"].endswith(".md")
        ]
        assert len(md_calls) == 3

        # Manifest tables_generated should match
        manifest_call = [
            c
            for c in mock_s3.put_object.call_args_list
            if c[1]["Key"].endswith("_manifest.json")
        ][0]
        manifest = json.loads(manifest_call[1]["Body"].decode("utf-8"))
        assert manifest["tables_generated"] == len(md_calls)

    def test_overwrites_existing_docs_on_reprocess(self):
        """Re-processing a store prefix writes docs again (overwrite behavior)."""
        mock_s3 = MagicMock()
        mock_s3.head_object.return_value = {"ContentLength": 50}
        mock_s3.get_object.return_value = {
            "Body": MagicMock(read=lambda: b"CREATE TABLE orders (id INT);")
        }

        llm_output = self._make_complete_llm_output(["orders"])

        with (
            patch.object(schema, "s3", mock_s3),
            patch.object(schema, "DOCS_BUCKET", "docs-bucket"),
            patch.object(schema, "_generate_with_llm", return_value=llm_output),
        ):
            # First run
            result1 = generate_schema_docs("raw-bucket", "store", ["store/f.sql"])
            # Second run (re-process)
            result2 = generate_schema_docs("raw-bucket", "store", ["store/f.sql"])

        assert result1["docs_generated"] == 1
        assert result2["docs_generated"] == 1
        # put_object called for both runs (doc + manifest each time = 4 total)
        assert mock_s3.put_object.call_count == 4

    def test_no_raw_llm_output_in_return(self):
        mock_s3 = MagicMock()
        mock_s3.head_object.return_value = {"ContentLength": 50}
        mock_s3.get_object.return_value = {
            "Body": MagicMock(read=lambda: b"CREATE TABLE t (id INT);")
        }

        llm_output = self._make_complete_llm_output(["t"])

        with (
            patch.object(schema, "s3", mock_s3),
            patch.object(schema, "DOCS_BUCKET", "docs-bucket"),
            patch.object(schema, "_generate_with_llm", return_value=llm_output),
        ):
            result = generate_schema_docs("raw-bucket", "s", ["s/f.sql"])

        assert "raw_llm_output" not in result
        assert "files_read" not in result
