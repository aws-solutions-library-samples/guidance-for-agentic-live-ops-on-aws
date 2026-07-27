# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
Schema Search Tools

Provides @tool functions for searching schema metadata via the dedicated
Schema Knowledge Base. Supports natural language queries including
abbreviations and acronyms via glossary entries embedded in schema docs.

Usage:
  tools = create_schema_tools()
  # Pass tools list to a Strands agent
"""

import os
import logging
import threading
import boto3
from botocore.exceptions import ClientError
from strands import tool

logger = logging.getLogger(__name__)

SCHEMA_KB_ID = os.environ.get("SCHEMA_KB_ID", "")

bedrock_agent_runtime = boto3.client("bedrock-agent-runtime")

# Artifact collection for frontend data sources panel
_schema_search_artifacts: list[dict] = []
_schema_search_artifact_lock = threading.Lock()


def _thread_safe_append_schema_search(item: dict) -> None:
    """Append an artifact to _schema_search_artifacts under a lock for thread safety."""
    with _schema_search_artifact_lock:
        _schema_search_artifacts.append(item)


def get_schema_search_artifacts() -> list[dict]:
    """Return collected schema search artifacts for the sources event."""
    return list(_schema_search_artifacts)


def clear_schema_search_artifacts() -> None:
    """Clear collected schema search artifacts between requests."""
    _schema_search_artifacts.clear()


def _extract_table_name(s3_uri: str) -> str:
    """Extract a human-readable table name from an S3 URI.

    Expected path format: s3://bucket/store_name/table_name.md
    Returns 'store_name/table_name' or the raw key if parsing fails.
    """
    try:
        # Strip the s3://bucket/ prefix
        path = s3_uri.split("/", 3)[-1] if "://" in s3_uri else s3_uri
        # Remove .md extension if present
        if path.endswith(".md"):
            path = path[:-3]
        return path
    except Exception:
        return s3_uri


def create_schema_tools():
    """Create schema search tools for the agent runtime."""

    @tool
    def search_schema(query: str, store_filter: str = "") -> str:
        """Search schema metadata for tables and columns matching a natural language query.
        Queries the Schema Knowledge Base which contains standardized documentation
        for database tables across all onboarded data stores.

        Supports abbreviations and acronyms — glossary entries embedded in schema docs
        enable matching queries like "PB inventory" to "peanut_butter_inventory" table.

        Args:
            query: Natural language search query (e.g., "player purchase history",
                   "PB inventory", "transaction amount columns")
            store_filter: Optional data store name to restrict results to a single
                          store (e.g., "warehouse_a"). Leave empty to search all stores.

        Returns:
            str: Formatted search results with table names, relevance scores,
                 and matched content snippets. Returns "No matching schemas found"
                 if no results match.
        """
        if not SCHEMA_KB_ID:
            return "Schema Knowledge Base is not configured. SCHEMA_KB_ID environment variable is not set."

        if not query or not query.strip():
            return "Please provide a non-empty search query."

        logger.info(
            "Searching schema KB", extra={"query": query, "store_filter": store_filter}
        )

        try:
            response = bedrock_agent_runtime.retrieve(
                knowledgeBaseId=SCHEMA_KB_ID,
                retrievalQuery={"text": query},
                retrievalConfiguration={
                    "vectorSearchConfiguration": {
                        "numberOfResults": 50,
                    }
                },
            )
        except ClientError as e:
            logger.error("Schema KB retrieval failed: %s", e)
            return f"Schema search failed: {e}"
        except Exception as e:
            logger.error("Unexpected error during schema search: %s", e)
            return f"Schema search error: {e}"

        results = response.get("retrievalResults", [])

        # Filter by store if specified
        if store_filter:
            results = [
                r
                for r in results
                if f"/{store_filter}/"
                in r.get("location", {}).get("s3Location", {}).get("uri", "")
            ]

        if not results:
            return "No matching schemas found"

        # Format results ranked by relevance (already ranked by KB)
        formatted_lines = [f'**Schema Search Results** (query: "{query}")\n']

        artifact_matches = []
        for i, result in enumerate(results, 1):
            content = result.get("content", {}).get("text", "")
            s3_uri = result.get("location", {}).get("s3Location", {}).get("uri", "")
            score = result.get("score", 0)

            table_name = _extract_table_name(s3_uri)
            snippet = content[:800].strip()
            if len(content) > 800:
                snippet += "..."

            formatted_lines.append(f"**{i}. {table_name}** (relevance: {score:.2f})")
            formatted_lines.append(f"   {snippet}\n")

            artifact_matches.append(
                {
                    "table_name": table_name,
                    "relevance_score": round(score, 3),
                    "snippet": snippet[:200],
                }
            )

        # Collect artifact for sources event
        _thread_safe_append_schema_search(
            {
                "query": query,
                "store_filter": store_filter or None,
                "result_count": len(results),
                "matches": artifact_matches[:10],
            }
        )

        return "\n".join(formatted_lines)

    return [search_schema]
