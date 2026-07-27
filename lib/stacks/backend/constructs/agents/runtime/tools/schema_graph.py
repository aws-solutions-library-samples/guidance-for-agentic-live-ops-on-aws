# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
Schema Graph Tools

Provides @tool functions for traversing the schema graph stored in Neptune Serverless.
Supports finding join paths between tables via Gremlin shortest-path traversal
and listing table relationships via direct edge queries.

Usage:
  tools = create_graph_tools()
  # Pass tools list to a Strands agent
"""

import os
import logging
import threading

from boto3 import Session
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from gremlin_python.driver.driver_remote_connection import DriverRemoteConnection
from gremlin_python.process.anonymous_traversal import traversal
from gremlin_python.process.graph_traversal import __
from strands import tool

logger = logging.getLogger(__name__)

NEPTUNE_ENDPOINT = os.environ.get("NEPTUNE_ENDPOINT", "")

# Lazy-initialized Gremlin connection
_connection = None
_g = None

# Artifact collection for frontend data sources panel
_graph_query_artifacts: list[dict] = []
_graph_artifact_lock = threading.Lock()


def _thread_safe_append_graph(item: dict) -> None:
    """Append an artifact to _graph_query_artifacts under a lock for thread safety."""
    with _graph_artifact_lock:
        _graph_query_artifacts.append(item)


def get_graph_query_artifacts() -> list[dict]:
    """Return collected graph query artifacts for the sources event."""
    return list(_graph_query_artifacts)


def clear_graph_query_artifacts() -> None:
    """Clear collected graph query artifacts between requests."""
    _graph_query_artifacts.clear()


def _get_traversal():
    """Lazy-initialize Gremlin traversal source with SigV4 IAM auth."""
    global _connection, _g
    if _g is None:
        credentials = Session().get_credentials()
        if credentials is None:
            raise RuntimeError("No AWS credentials found for Neptune IAM auth")
        creds = credentials.get_frozen_credentials()
        region = Session().region_name or "us-west-2"
        request = AWSRequest(method="GET", url=NEPTUNE_ENDPOINT, data=None)
        SigV4Auth(creds, "neptune-db", region).add_auth(request)
        _connection = DriverRemoteConnection(
            NEPTUNE_ENDPOINT, "g", headers=dict(request.headers.items())
        )
        _g = traversal().withRemote(_connection)
    return _g


def _reset_connection():
    """Close and reset the Gremlin connection for retry on dropped connections."""
    global _connection, _g
    if _connection:
        try:
            _connection.close()
        except Exception:  # noqa: BLE001 - intentional: best-effort cleanup during reset
            pass
    _connection = None
    _g = None


def _execute_with_retry(fn):
    """Execute a Gremlin query function with one retry on connection failure.

    On the first failure, resets the connection and retries once. If the retry
    also fails, raises the exception.
    """
    try:
        return fn()
    except Exception as e:
        logger.warning("Gremlin query failed, resetting connection and retrying: %s", e)
        _reset_connection()
        try:
            return fn()
        except Exception as retry_err:
            logger.warning("Gremlin query failed after retry: %s", retry_err)
            raise


def _format_path(source: str, target: str, path: list[tuple[str, str]]) -> str:
    """Format a join path as a readable string."""
    lines = [
        f"**Join path: {source} → {target}** ({len(path)} hop{'s' if len(path) != 1 else ''})\n"
    ]

    for i, (src_col, tgt_col) in enumerate(path, 1):
        lines.append(f"  {i}. JOIN ON {src_col} = {tgt_col}")

    # Build the SQL-style join hint
    lines.append("\nSQL hint:")
    tables_in_path = [source]
    for src_col, tgt_col in path:
        tgt_table = tgt_col.rsplit(".", 1)[0] if "." in tgt_col else tgt_col
        tables_in_path.append(tgt_table)

    for i, (src_col, tgt_col) in enumerate(path):
        if i == 0:
            lines.append(f"  FROM {tables_in_path[0]}")
        lines.append(f"  JOIN {tables_in_path[i + 1]} ON {src_col} = {tgt_col}")

    return "\n".join(lines)


def _parse_shortest_path(
    raw_path, source_table: str, target_table: str
) -> list[tuple[str, str]]:
    """Parse a Gremlin path result into a list of (source_col, target_col) tuples.

    The repeat/until traversal produces a path of alternating vertices and edges:
    Table -> HAS_COLUMN edge -> Column -> JOINS_ON edge -> Column -> HAS_COLUMN edge -> Table -> ...

    The path objects are: [Table, Column, Column, Table, Column, Column, Table, ...]
    Each group of (Column_from, Column_to) across a JOINS_ON edge is one hop.
    """
    hops = []
    objects = list(raw_path.objects) if hasattr(raw_path, "objects") else list(raw_path)

    # The path structure from repeat/until is:
    # [SourceTable, Col_src, Col_tgt, IntermediateTable, Col_src2, Col_tgt2, TargetTable, ...]
    # Every 3 elements after the first represents one hop:
    # objects[0] = source Table
    # objects[1] = source Column (outE HAS_COLUMN -> inV)
    # objects[2] = target Column (outE JOINS_ON -> inV)
    # objects[3] = next Table (inE HAS_COLUMN -> outV)
    # ... and so on

    # Extract column names from path elements
    # Path elements are vertices; we need their 'name' property
    i = 1  # Start after the source Table vertex
    while i + 1 < len(objects):
        src_col_vertex = objects[i]
        tgt_col_vertex = objects[i + 1]

        # Extract name from vertex (could be a dict or a Vertex object)
        src_name = _get_vertex_name(src_col_vertex)
        tgt_name = _get_vertex_name(tgt_col_vertex)

        if src_name and tgt_name:
            hops.append((src_name, tgt_name))

        i += 3  # Skip to next hop (Column, Column, Table)

    return hops


def _get_vertex_name(vertex) -> str:
    """Extract the 'name' property from a Gremlin vertex result."""
    if isinstance(vertex, dict):
        return vertex.get("name", str(vertex))
    if hasattr(vertex, "properties"):
        # Vertex object from gremlinpython
        props = vertex.properties
        if isinstance(props, dict) and "name" in props:
            return props["name"]
    if hasattr(vertex, "id"):
        return str(vertex.id)
    return str(vertex)


def create_graph_tools():
    """Create schema graph traversal tools for the agent runtime."""

    @tool
    def find_join_path(source_table: str, target_table: str, max_hops: int = 5) -> str:
        """Find the shortest join path between two database tables.

        Uses Gremlin shortest-path traversal over the Neptune schema graph to find
        how to join two tables via foreign key relationships. Returns the FK chain
        showing which columns to join on at each hop.

        Args:
            source_table: Starting table name (e.g. "liveops.guild_activities"
                          or just "guild_activities")
            target_table: Destination table name (e.g. "liveops.campaigns"
                          or just "campaigns")
            max_hops: Maximum number of joins to traverse (default 5)

        Returns:
            str: Formatted join path showing the FK chain, or a message if no path found.
        """
        if not NEPTUNE_ENDPOINT:
            return "Schema graph is not configured. NEPTUNE_ENDPOINT environment variable is not set."

        if not source_table or not target_table:
            return "Please provide both source_table and target_table."

        if source_table == target_table:
            return f"Source and target are the same table: {source_table}"

        try:

            def _query():
                g = _get_traversal()

                # Verify both tables exist
                for name in [source_table, target_table]:
                    exists = g.V().has("Table", "name", name).hasNext()
                    if not exists:
                        return ("not_found", name)

                # Shortest path via repeat/until traversal over JOINS_ON edges
                raw_paths = (
                    g.V()
                    .has("Table", "name", source_table)
                    .repeat(
                        __.outE("HAS_COLUMN")
                        .inV()
                        .outE("JOINS_ON")
                        .inV()
                        .inE("HAS_COLUMN")
                        .outV()
                        .simplePath()
                    )
                    .until(__.has("Table", "name", target_table))
                    .limit(1)
                    .path()
                    .toList()
                )

                if not raw_paths:
                    return ("no_path", None)

                return ("found", raw_paths[0])

            result = _execute_with_retry(_query)

            if result[0] == "not_found":
                return f"Table '{result[1]}' not found in the schema graph."

            if result[0] == "no_path":
                _thread_safe_append_graph(
                    {
                        "tool": "find_join_path",
                        "source_table": source_table,
                        "target_table": target_table,
                        "hops": 0,
                        "path": [],
                    }
                )
                return (
                    f"No join path found between '{source_table}' and '{target_table}' "
                    f"within {max_hops} hops."
                )

            # Parse the path into column pairs
            raw_path = result[1]
            hops = _parse_shortest_path(raw_path, source_table, target_table)

            if not hops:
                _thread_safe_append_graph(
                    {
                        "tool": "find_join_path",
                        "source_table": source_table,
                        "target_table": target_table,
                        "hops": 0,
                        "path": [],
                    }
                )
                return (
                    f"No join path found between '{source_table}' and '{target_table}' "
                    f"within {max_hops} hops."
                )

            formatted = _format_path(source_table, target_table, hops)
            _thread_safe_append_graph(
                {
                    "tool": "find_join_path",
                    "source_table": source_table,
                    "target_table": target_table,
                    "hops": len(hops),
                    "path": [{"from": s, "to": t} for s, t in hops],
                }
            )
            return formatted

        except Exception as e:
            logger.error("find_join_path failed: %s", e)
            _reset_connection()
            return (
                f"Schema graph service is unavailable. "
                f"Neptune endpoint: {NEPTUNE_ENDPOINT}. "
                f"Error: {e}. Please try again later."
            )

    @tool
    def list_table_relationships(table_name: str) -> str:
        """List all direct foreign key and equivalence relationships for a table.

        Shows which columns in this table join to other tables via JOINS_ON edges,
        and which columns have cross-store equivalences via EQUIVALENT_TO edges.

        Args:
            table_name: Table name (e.g. "liveops.players" or "players")

        Returns:
            str: Formatted list of relationships, or a message if none found.
        """
        if not NEPTUNE_ENDPOINT:
            return "Schema graph is not configured. NEPTUNE_ENDPOINT environment variable is not set."

        if not table_name:
            return "Please provide a table_name."

        try:

            def _query():
                g = _get_traversal()

                # Verify table exists
                exists = g.V().has("Table", "name", table_name).hasNext()
                if not exists:
                    return ("not_found", None)

                # Query all JOINS_ON and EQUIVALENT_TO relationships for this table's columns
                raw_results = (
                    g.V()
                    .has("Table", "name", table_name)
                    .outE("HAS_COLUMN")
                    .inV()
                    .as_("col")
                    .bothE("JOINS_ON", "EQUIVALENT_TO")
                    .otherV()
                    .as_("target")
                    .select("col", "target")
                    .by("name")
                    .by("name")
                    .toList()
                )

                return ("found", raw_results)

            result = _execute_with_retry(_query)

            if result[0] == "not_found":
                return f"Table '{table_name}' not found in the schema graph."

            raw_results = result[1]

            if not raw_results:
                _thread_safe_append_graph(
                    {
                        "tool": "list_table_relationships",
                        "table_name": table_name,
                        "relationship_count": 0,
                        "relationships": [],
                    }
                )
                return f"No foreign key relationships found for '{table_name}'."

            # Deduplicate and format
            seen = set()
            relationships = []
            lines = [f"**Relationships for {table_name}:**\n"]

            for row in raw_results:
                col_name = row.get("col", "") if isinstance(row, dict) else str(row)
                target_name = (
                    row.get("target", "") if isinstance(row, dict) else str(row)
                )
                key = (col_name, target_name)
                if key not in seen:
                    seen.add(key)
                    lines.append(f"  {col_name} → {target_name}")
                    relationships.append({"from": col_name, "to": target_name})

            _thread_safe_append_graph(
                {
                    "tool": "list_table_relationships",
                    "table_name": table_name,
                    "relationship_count": len(relationships),
                    "relationships": relationships,
                }
            )

            return "\n".join(lines)

        except Exception as e:
            logger.error("list_table_relationships failed: %s", e)
            _reset_connection()
            return (
                f"Schema graph service is unavailable. "
                f"Neptune endpoint: {NEPTUNE_ENDPOINT}. "
                f"Error: {e}. Please try again later."
            )

    return [find_join_path, list_table_relationships]
