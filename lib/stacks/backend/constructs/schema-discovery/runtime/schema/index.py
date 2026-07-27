# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Schema Agent Lambda — reads raw schema files from S3 and generates
standardized markdown docs using Bedrock Claude.

Triggered by EventBridge S3 Object Created events. Extracts the store name
from the first path segment of the object key, reads ALL files under that
store prefix, then delegates to the LLM for doc generation.
"""

import os
import re
import json
import math
import datetime
from pathlib import Path

import boto3
from aws_lambda_powertools import Logger

logger = Logger(service="schema-agent")

RAW_BUCKET = os.environ.get("RAW_BUCKET", "")
DOCS_BUCKET = os.environ.get("DOCS_BUCKET", "")
BEDROCK_MODEL_ID = os.environ.get(
    "BEDROCK_MODEL_ID", "us.anthropic.claude-haiku-4-5-20251001-v1:0"
)

s3 = boto3.client("s3")
bedrock_runtime = boto3.client("bedrock-runtime")

# 100 MB per-file size limit
MAX_FILE_SIZE = 100 * 1024 * 1024


def _list_store_keys(bucket: str, store_name: str) -> list[str]:
    """List all object keys under a store prefix in the raw bucket."""
    prefix = f"{store_name}/"
    keys: list[str] = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            keys.append(obj["Key"])
    return keys


def _read_file(bucket: str, key: str) -> tuple[str | None, str | None]:
    """Read a single file from S3.

    Returns (content, None) on success or (None, warning_message) on failure.
    Rejects files exceeding MAX_FILE_SIZE.
    """
    try:
        head = s3.head_object(Bucket=bucket, Key=key)
        size = head.get("ContentLength", 0)
        if size > MAX_FILE_SIZE:
            msg = f"File {key} exceeds 100MB limit ({size} bytes) — skipped"
            logger.warning(msg)
            return None, msg

        if size == 0:
            msg = f"File {key} is empty — skipped"
            logger.warning(msg)
            return None, msg

        response = s3.get_object(Bucket=bucket, Key=key)
        body = response["Body"].read()

        try:
            content = body.decode("utf-8")
        except UnicodeDecodeError:
            try:
                content = body.decode("latin-1")
            except Exception:
                msg = f"File {key} has unreadable encoding — skipped"
                logger.warning(msg)
                return None, msg

        return content, None

    except Exception as e:
        msg = f"Failed to read {key}: {str(e)}"
        logger.warning(msg)
        return None, msg


def _load_prompt_template() -> str:
    """Read the schema generation prompt template from the prompts/ directory."""
    prompt_path = Path(__file__).parent / "prompts" / "schema_generation.md"
    return prompt_path.read_text(encoding="utf-8")


# Pattern that matches all CREATE TABLE variants (including OR REPLACE, EXTERNAL, etc.)
_CREATE_TABLE_RE = re.compile(
    r"CREATE\s+(?:OR\s+REPLACE\s+)?(?:EXTERNAL\s+)?TABLE", re.IGNORECASE
)


def _estimate_table_count(file_contents: dict[str, str]) -> int:
    """Rough estimate of table count from file contents.

    Looks for CREATE TABLE statements in SQL, top-level keys in JSON,
    table headers in CSV (one table per CSV file), etc.
    """
    count = 0
    for key, content in file_contents.items():
        lower_key = key.lower()

        if lower_key.endswith(".sql") or lower_key.endswith(".ddl"):
            # Count CREATE TABLE statements
            count += len(_CREATE_TABLE_RE.findall(content))

        elif lower_key.endswith(".json"):
            # Each top-level key in a JSON object could be a table
            try:
                data = json.loads(content)
                if isinstance(data, dict):
                    count += len(data)
                elif isinstance(data, list):
                    count += len(data)
                else:
                    count += 1
            except (json.JSONDecodeError, ValueError):
                count += 1

        elif lower_key.endswith(".csv") or lower_key.endswith(".tsv"):
            # Each CSV/TSV file typically represents one table
            count += 1

        elif lower_key.endswith(".yaml") or lower_key.endswith(".yml"):
            # Rough estimate: count top-level keys
            top_level_keys = 0
            for line in content.split("\n"):
                if line and not line.startswith(" ") and not line.startswith("#"):
                    top_level_keys += 1
            count += max(top_level_keys, 1)

        else:
            # Free-form text or unknown format — check for CREATE TABLE
            found = len(_CREATE_TABLE_RE.findall(content))
            if found:
                count += found
            else:
                # Assume at least 1 table per file
                count += 1

    return max(count, 1)


def _chunk_file_contents(
    file_contents: dict[str, str], chunk_size: int = 75
) -> list[str]:
    """If estimated tables > 500, split concatenated content into chunks.

    Each chunk is a string of file contents representing roughly chunk_size
    tables. For smaller schemas, returns a single chunk with all content.
    """
    estimated = _estimate_table_count(file_contents)

    # Concatenate all file contents with file-name headers
    parts: list[str] = []
    for key, content in file_contents.items():
        parts.append(f"--- FILE: {key} ---\n{content}")
    full_text = "\n\n".join(parts)

    if estimated <= 500:
        return [full_text]

    # Split into roughly equal chunks based on estimated table count
    num_chunks = max(1, math.ceil(estimated / chunk_size))
    lines = full_text.split("\n")
    total_lines = len(lines)
    lines_per_chunk = max(1, math.ceil(total_lines / num_chunks))

    chunks: list[str] = []
    for i in range(0, total_lines, lines_per_chunk):
        chunk = "\n".join(lines[i : i + lines_per_chunk])
        if chunk.strip():
            chunks.append(chunk)

    logger.info(
        "Chunked file contents",
        extra={
            "estimated_tables": estimated,
            "num_chunks": len(chunks),
            "chunk_size": chunk_size,
        },
    )

    return chunks if chunks else [full_text]


def _call_bedrock(prompt: str) -> str:
    """Call Bedrock Claude via invoke_model and return the response text."""
    body = json.dumps(
        {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 100000,
            "messages": [{"role": "user", "content": prompt}],
        }
    )

    response = bedrock_runtime.invoke_model(
        modelId=BEDROCK_MODEL_ID,
        contentType="application/json",
        accept="application/json",
        body=body,
    )

    result = json.loads(response["body"].read())
    return result["content"][0]["text"]


def _generate_with_llm(store_name: str, file_contents: dict[str, str]) -> str:
    """Orchestrate LLM-based schema doc generation.

    Loads the prompt template, estimates table count, chunks if needed,
    calls Bedrock for each chunk, and concatenates results with
    ``---SPLIT---`` delimiters between chunks.
    """
    template = _load_prompt_template()
    prompt_prefix = template.replace("{store_name}", store_name)

    chunks = _chunk_file_contents(file_contents)

    logger.info(
        "Starting LLM generation",
        extra={
            "store_name": store_name,
            "num_chunks": len(chunks),
            "estimated_tables": _estimate_table_count(file_contents),
        },
    )

    results: list[str] = []
    for idx, chunk in enumerate(chunks):
        logger.info(
            "Processing chunk",
            extra={"chunk_index": idx + 1, "total_chunks": len(chunks)},
        )
        full_prompt = (
            f"{prompt_prefix}\n\n"
            f"--- RAW SCHEMA FILES (chunk {idx + 1}/{len(chunks)}) ---\n\n"
            f"{chunk}"
        )
        result = _call_bedrock(full_prompt)
        results.append(result)

    # Join chunk results with the split delimiter so downstream parsing
    # can treat the entire output uniformly.
    return "\n---SPLIT---\n".join(results)


# ---------------------------------------------------------------------------
# LLM output parsing and validation (task 5.3)
# ---------------------------------------------------------------------------

# The five required sections (case-insensitive match on heading text)
_REQUIRED_SECTIONS = ["Description", "Columns", "Relationships", "Glossary", "Notes"]

# Expected column headers in the Columns markdown table
_EXPECTED_COLUMN_HEADERS = [
    "Column",
    "Type",
    "Nullable",
    "Description",
    "Business Term",
]

# Regex to match a level-2 heading (## SectionName)
_SECTION_HEADING_RE = re.compile(r"^##\s+(.+)$", re.MULTILINE)

# Regex to extract table name from the level-1 heading (# Table: ...)
_TABLE_NAME_RE = re.compile(r"^#\s+Table:\s*(.+)$", re.MULTILINE)

# Counter for unknown table fallback names
_unknown_table_counter = 0


def parse_llm_output(raw_output: str) -> list[str]:
    """Split LLM output on ``---SPLIT---`` delimiter.

    Returns a list of individual table doc strings with whitespace stripped
    and empty segments filtered out.
    """
    segments = raw_output.split("---SPLIT---")
    return [seg.strip() for seg in segments if seg.strip()]


def _extract_table_name(doc: str) -> str:
    """Extract the table name from the ``# Table: ...`` header line.

    Returns the table name or a fallback like ``unknown_table_N``.
    """
    global _unknown_table_counter

    match = _TABLE_NAME_RE.search(doc)
    if match:
        raw_name = match.group(1).strip()
        # Use the last segment of a dotted name as the file-friendly name
        # e.g. "warehouse_a.public.orders" → "orders"
        parts = raw_name.split(".")
        table_name = parts[-1].strip() if parts else raw_name
        if table_name:
            return table_name

    _unknown_table_counter += 1
    return f"unknown_table_{_unknown_table_counter}"


def _validate_and_repair_doc(doc: str) -> tuple[str, list[str]]:
    """Validate a single doc has all 5 required sections.

    For each missing section, appends the section with a sensible default
    or a ``<!-- TODO: ... -->`` marker.

    Returns:
        (repaired_doc, list_of_issues)
    """
    issues: list[str] = []

    # Build a set of existing section names (case-insensitive)
    existing_headings = {
        m.group(1).strip().lower() for m in _SECTION_HEADING_RE.finditer(doc)
    }

    additions: list[str] = []

    for section in _REQUIRED_SECTIONS:
        if section.lower() not in existing_headings:
            issues.append(f"Missing section: {section}")

            if section == "Description":
                additions.append("## Description\n<!-- TODO: verify description -->")
            elif section == "Columns":
                additions.append(
                    "## Columns\n"
                    "| Column | Type | Nullable | Description | Business Term |\n"
                    "|--------|------|----------|-------------|---------------|\n"
                    "<!-- TODO: add columns -->"
                )
            elif section == "Relationships":
                additions.append("## Relationships\nNo foreign keys detected.")
            elif section == "Glossary":
                additions.append("## Glossary\nNo glossary entries.")
            elif section == "Notes":
                additions.append(
                    "## Notes\n<!-- TODO: Add any business context, data quality notes, or ownership info -->"
                )

    if additions:
        doc = doc.rstrip() + "\n\n" + "\n\n".join(additions)

    return doc, issues


def _validate_columns_table(doc: str) -> tuple[str, list[str]]:
    """Check that the Columns section has a markdown table with correct headers.

    If the headers are wrong or missing, repairs them. Preserves existing
    data rows.

    Returns:
        (repaired_doc, issues)
    """
    issues: list[str] = []

    # Find the Columns section
    columns_match = re.search(r"^##\s+Columns\s*$", doc, re.MULTILINE | re.IGNORECASE)
    if not columns_match:
        # No Columns section at all — nothing to validate (handled by _validate_and_repair_doc)
        return doc, issues

    # Extract content between ## Columns and the next ## heading (or end of doc)
    start = columns_match.end()
    next_section = re.search(r"^##\s+", doc[start:], re.MULTILINE)
    end = start + next_section.start() if next_section else len(doc)
    columns_content = doc[start:end]

    # Look for a markdown table header row (line starting with |)
    table_lines = [
        line for line in columns_content.split("\n") if line.strip().startswith("|")
    ]

    expected_header = "| Column | Type | Nullable | Description | Business Term |"
    expected_separator = "|--------|------|----------|-------------|---------------|"

    if not table_lines:
        # No table found — add empty table with correct headers
        issues.append("Columns section has no markdown table")
        repaired_section = (
            f"\n{expected_header}\n{expected_separator}\n<!-- TODO: add columns -->\n"
        )
        doc = doc[:start] + repaired_section + doc[end:]
        return doc, issues

    # Check if the first table line has the correct headers
    header_line = table_lines[0].strip()
    header_cells = [c.strip() for c in header_line.strip("|").split("|")]

    if header_cells != _EXPECTED_COLUMN_HEADERS:
        issues.append(
            f"Columns table has wrong headers: {header_cells}, "
            f"expected: {_EXPECTED_COLUMN_HEADERS}"
        )

        # Rebuild: replace the header row and separator, keep data rows
        data_rows = []
        for line in table_lines:
            stripped = line.strip()
            # Skip the original header line
            if stripped == header_line:
                continue
            # Skip separator lines (all dashes/pipes/spaces)
            if re.match(r"^\|[\s\-|:]+\|$", stripped):
                continue
            # Keep data rows
            data_rows.append(line)

        # Reconstruct the columns section
        new_lines = [
            "",
            expected_header,
            expected_separator,
        ]
        new_lines.extend(data_rows)
        new_lines.append("")

        # Also include any non-table content (TODO markers, text)
        non_table_lines = [
            line
            for line in columns_content.split("\n")
            if line.strip() and not line.strip().startswith("|")
        ]
        new_lines.extend(non_table_lines)
        new_lines.append("")

        doc = doc[:start] + "\n".join(new_lines) + doc[end:]

    return doc, issues


def validate_docs(raw_output: str) -> tuple[list[dict], list[str]]:
    """Orchestrate LLM output parsing and validation.

    Calls ``parse_llm_output``, then for each doc calls
    ``_extract_table_name``, ``_validate_and_repair_doc``, and
    ``_validate_columns_table``.

    Returns:
        (list of {table_name, content, has_todos} dicts, list of all warnings)
    """
    global _unknown_table_counter
    _unknown_table_counter = 0

    segments = parse_llm_output(raw_output)
    all_warnings: list[str] = []
    docs: list[dict] = []

    for seg in segments:
        table_name = _extract_table_name(seg)

        # Validate and repair required sections
        repaired, section_issues = _validate_and_repair_doc(seg)
        if section_issues:
            for issue in section_issues:
                all_warnings.append(f"{table_name}: {issue}")

        # Validate and repair columns table headers
        repaired, col_issues = _validate_columns_table(repaired)
        if col_issues:
            for issue in col_issues:
                all_warnings.append(f"{table_name}: {issue}")

        has_todos = "<!-- TODO:" in repaired

        docs.append(
            {
                "table_name": table_name,
                "content": repaired,
                "has_todos": has_todos,
            }
        )

    return docs, all_warnings


def _write_doc_to_s3(store_name: str, table_name: str, content: str) -> None:
    """Write a single schema doc to the docs bucket at {store_name}/{table_name}.md."""
    key = f"{store_name}/{table_name}.md"
    s3.put_object(
        Bucket=DOCS_BUCKET,
        Key=key,
        Body=content.encode("utf-8"),
        ContentType="text/markdown",
    )
    logger.info("Wrote doc to S3", extra={"key": key})


def _write_manifest(
    store_name: str,
    source_files: list[str],
    docs: list[dict],
    warnings: list[str],
) -> str:
    """Generate and write _manifest.json to the docs bucket.

    Returns the manifest S3 key.
    """
    tables_with_todos = sum(1 for d in docs if d.get("has_todos"))
    manifest = {
        "store_name": store_name,
        "processed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source_files": source_files,
        "tables_generated": len(docs),
        "tables_with_todos": tables_with_todos,
        "warnings": warnings,
    }
    key = f"{store_name}/_manifest.json"
    s3.put_object(
        Bucket=DOCS_BUCKET,
        Key=key,
        Body=json.dumps(manifest, indent=2).encode("utf-8"),
        ContentType="application/json",
    )
    logger.info("Wrote manifest to S3", extra={"key": key, "manifest": manifest})
    return key


def generate_schema_docs(bucket: str, store_name: str, file_keys: list[str]) -> dict:
    """Read raw schema files from S3 and generate standardized markdown docs.

    Args:
        bucket: Name of the raw-schemas S3 bucket.
        store_name: Top-level store prefix (e.g. "warehouse_a").
        file_keys: List of S3 object keys under the store prefix.

    Returns:
        dict with keys: docs_generated, output_prefix, manifest_key, warnings
    """
    warnings: list[str] = []
    file_contents: dict[str, str] = {}

    logger.info(
        "Reading raw schema files",
        extra={"store_name": store_name, "file_count": len(file_keys)},
    )

    for key in file_keys:
        content, warning = _read_file(bucket, key)
        if warning:
            warnings.append(warning)
            continue
        file_contents[key] = content

    if not file_contents:
        logger.error(
            "No readable files found for store",
            extra={"store_name": store_name, "warnings": warnings},
        )
        return {
            "docs_generated": 0,
            "output_prefix": f"{store_name}/",
            "manifest_key": f"{store_name}/_manifest.json",
            "warnings": warnings,
            "error": "No readable files found",
        }

    logger.info(
        "Files read successfully",
        extra={
            "store_name": store_name,
            "readable_files": len(file_contents),
            "skipped_files": len(warnings),
        },
    )

    # --- LLM call to generate schema docs ---
    try:
        raw_llm_output = _generate_with_llm(store_name, file_contents)
    except Exception as e:
        logger.exception("LLM generation failed")
        warnings.append(f"LLM generation failed: {str(e)}")
        return {
            "docs_generated": 0,
            "output_prefix": f"{store_name}/",
            "manifest_key": f"{store_name}/_manifest.json",
            "warnings": warnings,
            "error": f"LLM generation failed: {str(e)}",
        }

    logger.info(
        "LLM generation complete",
        extra={
            "store_name": store_name,
            "output_length": len(raw_llm_output),
        },
    )

    # --- Parse and validate LLM output ---
    docs, validation_warnings = validate_docs(raw_llm_output)
    all_warnings = warnings + validation_warnings

    # --- Write each doc to S3 ---
    for doc in docs:
        _write_doc_to_s3(store_name, doc["table_name"], doc["content"])

    # --- Write manifest ---
    source_files = [key.split("/")[-1] for key in file_keys]
    manifest_key = _write_manifest(store_name, source_files, docs, all_warnings)

    logger.info(
        "Doc writing complete",
        extra={
            "store_name": store_name,
            "docs_generated": len(docs),
            "manifest_key": manifest_key,
        },
    )

    return {
        "docs_generated": len(docs),
        "output_prefix": f"{store_name}/",
        "manifest_key": manifest_key,
        "warnings": all_warnings,
    }


@logger.inject_lambda_context(log_event=True)
def handler(event: dict, context: object) -> dict:
    """Lambda entry point — triggered by EventBridge S3 Object Created events.

    Expected event shape:
        {
            "source": "aws.s3",
            "detail-type": "Object Created",
            "detail": {
                "bucket": {"name": "raw-schemas-bucket-name"},
                "object": {"key": "warehouse_a/columns.csv"}
            }
        }
    """
    try:
        detail = event.get("detail", {})
        bucket = detail.get("bucket", {}).get("name", RAW_BUCKET)
        object_key = detail.get("object", {}).get("key", "")

        if not bucket:
            logger.error("No bucket name in event or RAW_BUCKET env var")
            return {"statusCode": 400, "body": "Missing bucket name"}

        if not object_key:
            logger.error("No object key in event")
            return {"statusCode": 400, "body": "Missing object key"}

        # Extract store_name from the first path segment
        parts = object_key.split("/")
        if len(parts) < 2:
            logger.error(
                "Object key has no store prefix",
                extra={"object_key": object_key},
            )
            return {"statusCode": 400, "body": "Object key must include a store prefix"}

        store_name = parts[0]
        logger.info(
            "Processing store",
            extra={
                "bucket": bucket,
                "store_name": store_name,
                "trigger_key": object_key,
            },
        )

        # List ALL objects under the store prefix
        file_keys = _list_store_keys(bucket, store_name)
        if not file_keys:
            logger.warning(
                "No files found under store prefix",
                extra={"store_name": store_name},
            )
            return {
                "statusCode": 200,
                "body": json.dumps(
                    {"message": "No files found", "store_name": store_name}
                ),
            }

        logger.info(
            "Found files under store prefix",
            extra={"store_name": store_name, "file_count": len(file_keys)},
        )

        result = generate_schema_docs(bucket, store_name, file_keys)

        logger.info("Schema doc generation complete", extra={"result": result})

        return {
            "statusCode": 200,
            "body": json.dumps(result),
        }

    except Exception:
        logger.exception(
            "Schema Agent failed", extra={"request_id": context.aws_request_id}
        )
        return {
            "statusCode": 500,
            "body": json.dumps(
                {
                    "error": f"Internal server error. Reference ID: {context.aws_request_id}"
                }
            ),
        }
