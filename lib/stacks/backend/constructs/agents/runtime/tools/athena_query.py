# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
Athena Query Tools

Provides @tool functions for specialized agents to query archived/historical
data via Athena + Glue. This is the structured data layer — use it
for precise SQL queries against the 14-table analytics catalog.

Data tiers:
  1. DynamoDB live metrics  → real-time sliding-window counters (minutes)
  2. Athena / Glue          → archived structured data (days/weeks/months)
  3. Knowledge Base          → pre-computed summary insights and reports
"""

import os
import time
import threading
import boto3
from botocore.exceptions import ClientError
from aws_lambda_powertools import Logger
from strands import tool

logger = Logger(service="athena-query-tools", level=os.getenv("LOG_LEVEL", "DEBUG"))

ATHENA_DATABASE = os.getenv("ATHENA_DATABASE", "liveops")
ATHENA_WORKGROUP = os.getenv("ATHENA_WORKGROUP", "liveops")
AWS_REGION = os.getenv("BEDROCK_REGION", "us-west-2")

# Global collector for Athena query artifacts (reset per request)
_athena_query_artifacts = []
_athena_artifact_lock = threading.Lock()


def _thread_safe_append_athena(item: dict) -> None:
    """Append an artifact to _athena_query_artifacts under a lock for thread safety."""
    with _athena_artifact_lock:
        _athena_query_artifacts.append(item)


def get_athena_artifacts():
    """Return collected Athena query artifacts."""
    return _athena_query_artifacts.copy()


def clear_athena_artifacts():
    """Clear collected Athena query artifacts."""
    _athena_query_artifacts.clear()


def _run_query(sql: str, timeout_seconds: int = 30) -> dict:
    """Execute SQL against Athena and return results."""
    athena = boto3.client("athena", region_name=AWS_REGION)

    try:
        response = athena.start_query_execution(
            QueryString=sql,
            QueryExecutionContext={"Database": ATHENA_DATABASE},
            WorkGroup=ATHENA_WORKGROUP,
        )
        query_id = response["QueryExecutionId"]
        logger.info(f"Started Athena query {query_id}: {sql[:120]}...")

        # Poll for completion
        start = time.time()
        while time.time() - start < timeout_seconds:
            status = athena.get_query_execution(QueryExecutionId=query_id)
            state = status["QueryExecution"]["Status"]["State"]

            if state == "SUCCEEDED":
                break
            if state in ("FAILED", "CANCELLED"):
                reason = status["QueryExecution"]["Status"].get(
                    "StateChangeReason", "Unknown error"
                )
                logger.error(f"Athena query {state}: {reason}")
                return {"error": f"Query {state}: {reason}", "query_id": query_id}

            time.sleep(1)
        else:
            return {
                "error": f"Query timed out after {timeout_seconds}s",
                "query_id": query_id,
            }

        # Fetch results (cap at 200 rows to keep agent context manageable)
        results = athena.get_query_results(QueryExecutionId=query_id, MaxResults=200)
        rows = results.get("ResultSet", {}).get("Rows", [])

        if not rows:
            return {"columns": [], "rows": [], "row_count": 0, "query_id": query_id}

        columns = [col.get("VarCharValue", "") for col in rows[0].get("Data", [])]
        data_rows = []
        for row in rows[1:]:
            data_rows.append(
                [cell.get("VarCharValue", "") for cell in row.get("Data", [])]
            )

        return {
            "columns": columns,
            "rows": data_rows,
            "row_count": len(data_rows),
            "query_id": query_id,
        }

    except ClientError as e:
        logger.error(f"Athena ClientError: {e}")
        return {"error": str(e)}
    except Exception as e:
        logger.error(f"Athena error: {e}")
        return {"error": str(e)}


def _format_results(results: dict) -> str:
    """Format Athena results as readable text for agents."""
    if "error" in results:
        return f"Query error: {results['error']}"

    if results["row_count"] == 0:
        return "Query returned no results."

    columns = results["columns"]
    rows = results["rows"]

    # Build a compact text table
    lines = [" | ".join(columns)]
    lines.append("-" * len(lines[0]))
    for row in rows[:50]:  # Cap display at 50 rows
        lines.append(" | ".join(str(v) for v in row))

    truncated = (
        f"\n... ({results['row_count']} total rows)"
        if results["row_count"] > 50
        else ""
    )
    return "\n".join(lines) + truncated


class MaxQueryAttemptsExceeded(Exception):
    """Raised when an agent exceeds the maximum allowed Athena query attempts."""


def create_athena_tools():
    """Create Athena query tools for specialized agents."""

    # Track query attempts per agent invocation to prevent infinite retry loops.
    # Using a mutable dict so the nested @tool closure can mutate it.
    _query_attempt_count = {"count": 0, "max": 3}

    @tool
    def query_data(sql: str) -> str:
        """Execute a SQL query against the analytics data warehouse (Athena/Glue).

        The database is 'liveops'. Schema context (table names, columns,
        relationships) is provided automatically via the Schema KB and Schema Graph
        — do NOT query information_schema or SHOW TABLES, that info is already in
        your context.

        IMPORTANT:
          - All string columns use OpenCSVSerde — use string comparisons, not date functions
          - Use LIMIT to keep results manageable (max 200 rows returned)
          - For date filtering, use string comparison: WHERE purchase_date >= '2024-01-01'
          - Column names are lowercase with underscores
          - You have a maximum of 3 query attempts per request
          - Do NOT waste queries on schema discovery — use the schema context provided

        Args:
            sql: A valid SQL query against the liveops database

        Returns:
            str: Query results formatted as a text table
        """
        if not ATHENA_DATABASE or not ATHENA_WORKGROUP:
            return (
                "Athena not configured — ATHENA_DATABASE or ATHENA_WORKGROUP not set."
            )

        _query_attempt_count["count"] += 1
        if _query_attempt_count["count"] > _query_attempt_count["max"]:
            logger.warning(
                "Max Athena query attempts exceeded",
                extra={
                    "attempts": _query_attempt_count["count"],
                    "max": _query_attempt_count["max"],
                },
            )
            raise MaxQueryAttemptsExceeded(
                f"Maximum query attempts ({_query_attempt_count['max']}) exceeded. "
                "Summarize results from previous successful queries or explain that the query could not be completed."
            )

        logger.info(
            "Executing Athena query",
            extra={"sql": sql[:200], "attempt": _query_attempt_count["count"]},
        )
        results = _run_query(sql, timeout_seconds=30)
        formatted = _format_results(results)
        logger.info(
            "Athena query complete",
            extra={
                "row_count": results.get("row_count", 0),
                "query_id": results.get("query_id"),
                "attempt": _query_attempt_count["count"],
            },
        )

        # Collect artifact for sources event
        if "error" not in results:
            _thread_safe_append_athena(
                {
                    "sql": sql,
                    "row_count": results.get("row_count", 0),
                    "columns": results.get("columns", []),
                    "sample_rows": results.get("rows", [])[:10],
                }
            )

        return formatted

    return [query_data]
