# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
Schema Context Module

Handles automatic schema discovery and context enrichment for agent queries.
Resolves Neptune endpoints, searches the Schema KB, and caches schema context
per-request so sub-agents get table/column/FK info without redundant lookups.
"""

import os
import threading
import boto3
from concurrent.futures import (
    ThreadPoolExecutor,
    TimeoutError as FuturesTimeoutError,
)
from aws_lambda_powertools import Logger

logger = Logger(service="liveops", level=os.getenv("LOG_LEVEL", "DEBUG"))

# Schema KB ID for metadata search
SCHEMA_KB_ID = os.getenv("SCHEMA_KB_ID", "")

# Neptune endpoint — resolved from SSM at startup to avoid CDK token circular dependency
_NEPTUNE_ENDPOINT_SSM_PARAM = os.getenv("NEPTUNE_ENDPOINT_SSM_PARAM", "")
_NEPTUNE_ENDPOINT_DIRECT = os.getenv("NEPTUNE_ENDPOINT", "")
AWS_REGION = os.getenv("BEDROCK_REGION", "us-west-2")


def _resolve_neptune_endpoint() -> str:
    """Resolve Neptune endpoint from SSM parameter or direct env var."""
    if _NEPTUNE_ENDPOINT_DIRECT:
        return _NEPTUNE_ENDPOINT_DIRECT
    if not _NEPTUNE_ENDPOINT_SSM_PARAM:
        return ""
    try:
        ssm = boto3.client("ssm", region_name=AWS_REGION)
        response = ssm.get_parameter(Name=_NEPTUNE_ENDPOINT_SSM_PARAM)
        hostname = response["Parameter"]["Value"]
        return f"wss://{hostname}:8182/gremlin"
    except Exception as e:
        logger.warning("Failed to resolve Neptune endpoint from SSM: %s", e)
        return ""


NEPTUNE_ENDPOINT = _resolve_neptune_endpoint()

# Propagate resolved endpoint to tool modules that read it at import time
if NEPTUNE_ENDPOINT:
    os.environ["NEPTUNE_ENDPOINT"] = NEPTUNE_ENDPOINT
    import tools.schema_graph as _sg_mod
    import tools.entity_resolution as _er_mod

    _sg_mod.NEPTUNE_ENDPOINT = NEPTUNE_ENDPOINT
    _er_mod.NEPTUNE_ENDPOINT = NEPTUNE_ENDPOINT

# Per-request cache — thread-local so concurrent requests don't collide
_schema_context_local = threading.local()

# Lazy singleton for bedrock-agent-runtime client
_bedrock_agent_runtime = None


def _get_bedrock_agent_runtime():
    global _bedrock_agent_runtime
    if _bedrock_agent_runtime is None:
        _bedrock_agent_runtime = boto3.client("bedrock-agent-runtime")
    return _bedrock_agent_runtime


def set_schema_context_cache(context: str, query: str) -> None:
    """Cache the schema context for the current thread/request."""
    _schema_context_local.value = context
    _schema_context_local.query = query


def enrich_subagent_query(query: str) -> str:
    """Prepend cached schema context to a sub-agent query.

    This gives sub-agents table/column/FK info from the Schema KB and Neptune
    graph so they can write correct SQL without wasting Athena queries on
    SHOW TABLES or information_schema lookups.
    """
    ctx = getattr(_schema_context_local, "value", "")
    if not ctx:
        return query
    return (
        f"{ctx}\n\n"
        "Do NOT query information_schema or SHOW TABLES — the schema info above "
        "has everything you need.\n\n---\n\n"
        f"{query}"
    )


def auto_schema_context(query: str) -> str:
    """Run schema search and graph lookup automatically for every query.

    Returns a formatted string to inject into the enhanced prompt, or empty
    string if schema tools are not configured. Has a 15-second timeout to
    avoid blocking the query if Neptune or KB is slow.
    """
    if not SCHEMA_KB_ID:
        return ""

    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(_auto_schema_context_inner, query)
            return future.result(timeout=15)
    except FuturesTimeoutError:
        logger.warning("Auto schema context timed out after 15s — skipping")
        return ""
    except Exception as e:
        logger.warning("Auto schema context failed: %s", e)
        return ""


def _auto_schema_context_inner(query: str) -> str:
    """Inner implementation of auto schema context (called with timeout)."""

    parts = []
    results = []

    # 1. Schema KB search (filter to relevance > 0.4)
    try:
        client = _get_bedrock_agent_runtime()
        response = client.retrieve(
            knowledgeBaseId=SCHEMA_KB_ID,
            retrievalQuery={"text": query},
            retrievalConfiguration={
                "vectorSearchConfiguration": {"numberOfResults": 10}
            },
        )
        results = response.get("retrievalResults", [])
        if results:
            schema_lines = [
                "**SCHEMA CONTEXT** (auto-discovered tables relevant to this query):"
            ]
            matches = []
            for r in results[:5]:
                content = r.get("content", {}).get("text", "")
                s3_uri = r.get("location", {}).get("s3Location", {}).get("uri", "")
                score = r.get("score", 0)

                if score < 0.4:
                    continue

                path = s3_uri.split("/", 3)[-1] if "://" in s3_uri else s3_uri
                if path.endswith(".md"):
                    path = path[:-3]
                snippet = content[:2000].strip()
                schema_lines.append(
                    f"- **{path}** (relevance: {score:.2f}):\n{snippet}"
                )
                matches.append(
                    {
                        "table_name": path,
                        "relevance_score": round(score, 3),
                        "snippet": snippet[:200],
                    }
                )

            if matches:
                parts.append("\n".join(schema_lines))

                from tools.schema_search import _schema_search_artifacts

                _schema_search_artifacts.append(
                    {
                        "query": query,
                        "store_filter": None,
                        "result_count": len(matches),
                        "matches": matches,
                    }
                )
    except Exception as e:
        logger.warning("Auto schema search failed: %s", e)

    # 2. Neptune graph: get columns and relationships for matched tables
    if NEPTUNE_ENDPOINT and results:
        try:
            from tools.schema_graph import _get_traversal
            from tools.schema_graph import _graph_query_artifacts

            g = _get_traversal()

            matched_tables = []
            for r in results[:5]:
                s3_uri = r.get("location", {}).get("s3Location", {}).get("uri", "")
                score = r.get("score", 0)
                if score < 0.4:
                    continue
                tpath = s3_uri.split("/", 3)[-1] if "://" in s3_uri else s3_uri
                if tpath.endswith(".md"):
                    tpath = tpath[:-3]
                tbasename = tpath.rsplit("/", 1)[-1] if "/" in tpath else tpath
                neptune_name = (
                    f"liveops.{tbasename}" if "." not in tbasename else tbasename
                )
                matched_tables.append(neptune_name)

            for neptune_table_name in matched_tables:
                logger.info("Auto graph lookup for table: %s", neptune_table_name)

                # 2a. Get all column names for this table
                try:
                    columns = (
                        g.V()
                        .has("Table", "name", neptune_table_name)
                        .outE("HAS_COLUMN")
                        .inV()
                        .values("name")
                        .toList()
                    )
                    if columns:
                        col_lines = [f"\n**COLUMNS** for {neptune_table_name}:"]
                        for col in columns:
                            col_lines.append(f"- {col}")
                        parts.append("\n".join(col_lines))
                except Exception as e:
                    logger.warning(
                        "Auto graph column lookup failed for %s: %s",
                        neptune_table_name,
                        e,
                    )

                # 2b. Get relationships (joins) for this table
                try:
                    rels = (
                        g.V()
                        .has("Table", "name", neptune_table_name)
                        .outE("HAS_COLUMN")
                        .inV()
                        .as_("col")
                        .bothE("JOINS_ON")
                        .otherV()
                        .as_("target")
                        .select("col", "target")
                        .by("name")
                        .by("name")
                        .toList()
                    )

                    logger.info(
                        "Auto graph lookup: found %d relationships for %s",
                        len(rels) if rels else 0,
                        neptune_table_name,
                    )

                    if rels:
                        join_lines = [
                            f"\n**GRAPH RELATIONSHIPS** for {neptune_table_name}:"
                        ]
                        graph_rels = []
                        seen = set()
                        for rel in rels:
                            src = rel.get("col", "")
                            tgt = rel.get("target", "")
                            key = (src, tgt)
                            if src and tgt and key not in seen:
                                seen.add(key)
                                join_lines.append(f"- {src} → {tgt}")
                                graph_rels.append({"from": src, "to": tgt})

                        if graph_rels:
                            parts.append("\n".join(join_lines))
                            _graph_query_artifacts.append(
                                {
                                    "tool": "list_table_relationships",
                                    "table_name": neptune_table_name,
                                    "relationship_count": len(graph_rels),
                                    "relationships": graph_rels,
                                }
                            )
                except Exception as e:
                    logger.warning(
                        "Auto graph relationship lookup failed for %s: %s",
                        neptune_table_name,
                        e,
                    )

        except Exception as e:
            logger.warning("Auto graph lookup failed: %s", e)

    return "\n\n".join(parts) if parts else ""
