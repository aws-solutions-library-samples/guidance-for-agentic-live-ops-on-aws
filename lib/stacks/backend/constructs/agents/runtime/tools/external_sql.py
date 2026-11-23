# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
External SQL Query Tools

Provides @tool functions for agents to query external data sources
(Databricks, Snowflake, PostgreSQL, MySQL, Redshift) via native Python
SDK connectors. Connection credentials are stored in AWS Secrets Manager.

Follows the same contract as athena_query.py:
  - Takes SQL, returns formatted text table
  - Caps results at 200 rows
  - Tracks query artifacts for the frontend sources panel
  - Maximum 3 query attempts per request

Data tiers:
  1. DynamoDB live metrics  → real-time sliding-window counters (minutes)
  2. Athena / Glue          → archived structured data (days/weeks/months)
  3. Knowledge Base         → pre-computed summary insights and reports
  4. External SQL           → customer-owned data warehouses (Databricks, Snowflake, etc.)
"""

import os
import re
import time
import json
import threading
import boto3
from botocore.exceptions import ClientError
from aws_lambda_powertools import Logger
from strands import tool

logger = Logger(service="external-sql-tools", level=os.getenv("LOG_LEVEL", "DEBUG"))

AWS_REGION = os.getenv("BEDROCK_REGION", "us-west-2")

# Default secret name — can be overridden per agent via config_overrides
DEFAULT_SECRET_NAME = os.getenv("EXTERNAL_SQL_SECRET", "")

# Query timeout in seconds
QUERY_TIMEOUT = 30

# Maximum rows to return
MAX_ROWS = 200

# Maximum rows to display in formatted output
MAX_DISPLAY_ROWS = 50

# Cached credentials (per secret name -> (fetched_at, credentials)).
# Entries expire after CREDENTIALS_TTL_SECONDS so rotated secrets are picked up.
CREDENTIALS_TTL_SECONDS = 15 * 60
_credentials_cache: dict[str, tuple[float, dict]] = {}
_credentials_lock = threading.Lock()

# Global collector for external query artifacts (reset per request)
_external_query_artifacts: list[dict] = []
_external_artifact_lock = threading.Lock()

# Layer 1 (allowlist): the statement must start with SELECT or WITH,
# after any leading whitespace and SQL comments.
_LEADING_COMMENTS = re.compile(r"^(?:\s+|--[^\n]*(?:\n|$)|/\*.*?\*/)*", re.DOTALL)
_READ_START = re.compile(r"(SELECT|WITH)\b", re.IGNORECASE)

# Layer 2 (blocklist): write / side-effect keywords anywhere in the query,
# including inside comments and CTEs (e.g. PostgreSQL `WITH x AS (DELETE ...)`,
# `SELECT ... INTO`, Snowflake `COPY INTO` / `PUT`, Redshift `UNLOAD`).
_WRITE_PATTERNS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|REPLACE|MERGE|GRANT|REVOKE"
    r"|INTO|COPY|CALL|EXEC|EXECUTE|PUT|UNLOAD)\b",
    re.IGNORECASE,
)


def _thread_safe_append_artifact(item: dict) -> None:
    """Append an artifact to _external_query_artifacts under a lock for thread safety."""
    with _external_artifact_lock:
        _external_query_artifacts.append(item)


def get_external_query_artifacts() -> list[dict]:
    """Return collected external query artifacts."""
    return _external_query_artifacts.copy()


def clear_external_query_artifacts() -> None:
    """Clear collected external query artifacts."""
    _external_query_artifacts.clear()


def _get_credentials(secret_name: str) -> dict:
    """Fetch credentials from Secrets Manager with caching.

    Credentials are cached per secret for CREDENTIALS_TTL_SECONDS (warm start
    reuse), then re-fetched so rotated secrets are picked up.
    """
    with _credentials_lock:
        cached = _credentials_cache.get(secret_name)
        if cached and time.monotonic() - cached[0] < CREDENTIALS_TTL_SECONDS:
            return cached[1]

    try:
        client = boto3.client("secretsmanager", region_name=AWS_REGION)
        response = client.get_secret_value(SecretId=secret_name)
        credentials = json.loads(response["SecretString"])

        with _credentials_lock:
            _credentials_cache[secret_name] = (time.monotonic(), credentials)

        logger.info(
            "Fetched external SQL credentials",
            extra={
                "secret_name": secret_name,
                "source_type": credentials.get("source_type", "unknown"),
            },
        )
        return credentials

    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "Unknown")
        logger.error(
            f"Failed to fetch credentials: {error_code}",
            extra={"secret_name": secret_name, "error": str(e)},
        )
        raise ValueError(
            f"Could not retrieve credentials from secret '{secret_name}': {error_code}. "
            "Verify the secret exists in Secrets Manager and the runtime has permission to read it."
        ) from e


# ---------------------------------------------------------------------------
# Source adapters
#
# Each adapter takes a credentials dict and returns a DB-API 2.0 connection.
# The connection must support: .cursor(), cursor.execute(sql),
# cursor.fetchmany(n), cursor.description, cursor.close(), connection.close()
# ---------------------------------------------------------------------------


def _connect_databricks(creds: dict):
    """Connect to Databricks SQL warehouse."""
    try:
        from databricks import sql as databricks_sql
    except ImportError:
        raise ImportError(
            "databricks-sql-connector is not installed. "
            "Add 'databricks-sql-connector' to requirements.txt."
        )

    return databricks_sql.connect(
        server_hostname=creds["host"],
        http_path=creds["http_path"],
        access_token=creds["access_token"],
        _socket_timeout=QUERY_TIMEOUT,
    )


def _connect_snowflake(creds: dict):
    """Connect to Snowflake."""
    try:
        import snowflake.connector
    except ImportError:
        raise ImportError(
            "snowflake-connector-python is not installed. "
            "Add 'snowflake-connector-python' to requirements.txt."
        )

    connect_params = {
        "account": creds["account"],
        "user": creds["user"],
        "password": creds["password"],
        "warehouse": creds.get("warehouse"),
        "database": creds.get("database"),
        "schema": creds.get("schema"),
        "login_timeout": QUERY_TIMEOUT,
        "network_timeout": QUERY_TIMEOUT,
    }
    # Remove None values so Snowflake connector doesn't complain
    connect_params = {k: v for k, v in connect_params.items() if v is not None}
    return snowflake.connector.connect(**connect_params)


def _connect_postgresql(creds: dict):
    """Connect to PostgreSQL (including Amazon RDS PostgreSQL)."""
    try:
        import psycopg2
    except ImportError:
        raise ImportError(
            "psycopg2-binary is not installed. "
            "Add 'psycopg2-binary' to requirements.txt."
        )

    return psycopg2.connect(
        host=creds["host"],
        port=creds.get("port", 5432),
        database=creds["database"],
        user=creds["user"],
        password=creds["password"],
        connect_timeout=QUERY_TIMEOUT,
        options="-c statement_timeout=%dms" % (QUERY_TIMEOUT * 1000),
    )


def _connect_mysql(creds: dict):
    """Connect to MySQL (including Amazon RDS MySQL)."""
    try:
        import pymysql
    except ImportError:
        raise ImportError(
            "pymysql is not installed. Add 'pymysql' to requirements.txt."
        )

    return pymysql.connect(
        host=creds["host"],
        port=creds.get("port", 3306),
        database=creds["database"],
        user=creds["user"],
        password=creds["password"],
        connect_timeout=QUERY_TIMEOUT,
        read_timeout=QUERY_TIMEOUT,
    )


def _connect_redshift(creds: dict):
    """Connect to Amazon Redshift."""
    try:
        import redshift_connector
    except ImportError:
        raise ImportError(
            "redshift-connector is not installed. "
            "Add 'redshift-connector' to requirements.txt."
        )

    return redshift_connector.connect(
        host=creds["host"],
        port=creds.get("port", 5439),
        database=creds["database"],
        user=creds["user"],
        password=creds["password"],
        timeout=QUERY_TIMEOUT,
    )


# Adapter registry
_ADAPTERS = {
    "databricks": _connect_databricks,
    "snowflake": _connect_snowflake,
    "postgresql": _connect_postgresql,
    "mysql": _connect_mysql,
    "redshift": _connect_redshift,
}

SUPPORTED_SOURCES = sorted(_ADAPTERS.keys())


def _get_connection(credentials: dict):
    """Create a database connection using the appropriate adapter.

    The source_type field in the credentials dict determines which adapter to use.
    """
    source_type = credentials.get("source_type", "").lower().strip()
    if not source_type:
        raise ValueError(
            "Credentials must include a 'source_type' field. "
            f"Supported types: {', '.join(SUPPORTED_SOURCES)}"
        )

    adapter = _ADAPTERS.get(source_type)
    if not adapter:
        raise ValueError(
            f"Unsupported source_type '{source_type}'. "
            f"Supported types: {', '.join(SUPPORTED_SOURCES)}"
        )

    return adapter(credentials)


def _validate_sql(sql: str) -> str | None:
    """Validate SQL for safety. Returns an error message or None if valid.

    Defense in depth only: the database credentials in Secrets Manager must
    belong to a read-only role. Checks fail closed (e.g. a ';' inside a string
    literal is rejected).
    """
    if not sql or not sql.strip():
        return "SQL query cannot be empty."

    # Blocklist first so write attempts get the clearest message.
    if _WRITE_PATTERNS.search(sql):
        return (
            "Write operations (INSERT, UPDATE, DELETE, DROP, etc.) are not allowed. "
            "This tool is read-only. Use SELECT queries only."
        )

    body = _LEADING_COMMENTS.sub("", sql, count=1).rstrip()
    if body.endswith(";"):
        body = body[:-1].rstrip()
    if not body:
        return "SQL query cannot be empty."

    if ";" in body:
        return "Only a single SQL statement is allowed per query."

    if not _READ_START.match(body):
        return "Only read-only queries starting with SELECT or WITH are allowed."

    return None


def _run_query(credentials: dict, sql: str) -> dict:
    """Execute SQL against an external source and return results."""
    connection = None
    cursor = None

    try:
        connection = _get_connection(credentials)
        cursor = connection.cursor()

        start_time = time.time()
        cursor.execute(sql)
        duration_ms = round((time.time() - start_time) * 1000, 2)

        # Extract column names from cursor.description
        if cursor.description:
            columns = [desc[0] for desc in cursor.description]
        else:
            columns = []

        # Fetch rows (capped at MAX_ROWS)
        rows = cursor.fetchmany(MAX_ROWS)
        data_rows = [
            [str(cell) if cell is not None else "" for cell in row] for row in rows
        ]

        source_type = credentials.get("source_type", "unknown")
        logger.info(
            f"External query completed ({source_type})",
            extra={
                "source_type": source_type,
                "row_count": len(data_rows),
                "column_count": len(columns),
                "duration_ms": duration_ms,
            },
        )

        return {
            "columns": columns,
            "rows": data_rows,
            "row_count": len(data_rows),
            "source_type": source_type,
            "duration_ms": duration_ms,
        }

    except Exception as e:
        logger.error(f"External query error: {e}", extra={"sql": sql[:200]})
        return {"error": str(e)}

    finally:
        if cursor:
            try:
                cursor.close()
            except Exception:
                pass
        if connection:
            try:
                connection.close()
            except Exception:
                pass


def _format_results(results: dict) -> str:
    """Format query results as readable text for agents."""
    if "error" in results:
        return f"Query error: {results['error']}"

    if results["row_count"] == 0:
        return "Query returned no results."

    columns = results["columns"]
    rows = results["rows"]

    # Build a compact text table (same format as Athena tool)
    lines = [" | ".join(columns)]
    lines.append("-" * len(lines[0]))
    for row in rows[:MAX_DISPLAY_ROWS]:
        lines.append(" | ".join(str(v) for v in row))

    truncated = (
        f"\n... ({results['row_count']} total rows)"
        if results["row_count"] > MAX_DISPLAY_ROWS
        else ""
    )

    source_label = results.get("source_type", "external").capitalize()
    duration = results.get("duration_ms", 0)
    header = f"[{source_label} query — {results['row_count']} rows, {duration}ms]\n\n"

    return header + "\n".join(lines) + truncated


class MaxQueryAttemptsExceeded(Exception):
    """Raised when an agent exceeds the maximum allowed query attempts."""


def create_external_sql_tools(secret_name_override: str = None):
    """Create external SQL query tools for agents.

    Args:
        secret_name_override: Optional secret name. If provided, overrides
            the EXTERNAL_SQL_SECRET env var. Used when the agent factory passes
            a per-agent secret from config_overrides.

    Returns:
        List of tool functions to register with an agent.
    """
    effective_secret = secret_name_override or DEFAULT_SECRET_NAME

    # Track query attempts per agent invocation (matches Athena pattern)
    _query_attempt_count = {"count": 0, "max": 3}

    @tool
    def query_external(sql: str) -> str:
        """Execute a SQL query against the configured external data source (Databricks, Snowflake, etc.).

        The external source and its schema context are configured separately.
        Use the schema context provided in your system prompt to understand
        available tables and columns — do NOT run schema discovery queries.

        IMPORTANT:
          - This is a READ-ONLY tool. Only SELECT queries are allowed.
          - Use the SQL dialect appropriate for the configured source
            (Spark SQL for Databricks, Snowflake SQL for Snowflake, etc.)
          - Use LIMIT to keep results manageable (max 200 rows returned)
          - You have a maximum of 3 query attempts per request
          - Do NOT waste queries on schema discovery — use the schema context provided

        Args:
            sql: A valid SELECT query for the configured external data source

        Returns:
            str: Query results formatted as a text table, or an error message
        """
        if not effective_secret:
            return (
                "External SQL not configured — EXTERNAL_SQL_SECRET environment variable "
                "is not set and no secret name override was provided in the agent config. "
                "See docs/external-data-integration.md for setup instructions."
            )

        # Enforce query attempt limit
        _query_attempt_count["count"] += 1
        if _query_attempt_count["count"] > _query_attempt_count["max"]:
            logger.warning(
                "Max external query attempts exceeded",
                extra={
                    "attempts": _query_attempt_count["count"],
                    "max": _query_attempt_count["max"],
                },
            )
            raise MaxQueryAttemptsExceeded(
                f"Maximum query attempts ({_query_attempt_count['max']}) exceeded. "
                "Summarize results from previous successful queries or explain "
                "that the query could not be completed."
            )

        # Validate SQL safety
        validation_error = _validate_sql(sql)
        if validation_error:
            logger.warning(
                "SQL validation failed",
                extra={"sql": sql[:200], "error": validation_error},
            )
            return f"Query rejected: {validation_error}"

        logger.info(
            "Executing external SQL query",
            extra={
                "sql": sql[:200],
                "secret_name": effective_secret,
                "attempt": _query_attempt_count["count"],
            },
        )

        # Fetch credentials and execute
        try:
            credentials = _get_credentials(effective_secret)
        except ValueError as e:
            return str(e)

        results = _run_query(credentials, sql)
        formatted = _format_results(results)

        logger.info(
            "External SQL query complete",
            extra={
                "row_count": results.get("row_count", 0),
                "source_type": results.get("source_type", "unknown"),
                "duration_ms": results.get("duration_ms", 0),
                "attempt": _query_attempt_count["count"],
            },
        )

        # Collect artifact for sources event (matches Athena pattern)
        if "error" not in results:
            _thread_safe_append_artifact(
                {
                    "sql": sql,
                    "source_type": results.get("source_type", "unknown"),
                    "row_count": results.get("row_count", 0),
                    "columns": results.get("columns", []),
                    "sample_rows": results.get("rows", [])[:10],
                    "duration_ms": results.get("duration_ms", 0),
                }
            )

        return formatted

    return [query_external]
