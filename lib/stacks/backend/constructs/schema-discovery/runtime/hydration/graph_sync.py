# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Graph sync module — parses schema docs and upserts nodes/edges into Neptune.

Called by the hydration Lambda after detecting updated docs. Parses the
Columns and Relationships sections from each markdown doc to build a
property graph representing the schema.

Graph model (Neptune LPG):
  Vertex labels: Table, Column
  Edge labels: HAS_COLUMN, JOINS_ON, EQUIVALENT_TO
  Upsert pattern: fold().coalesce(unfold(), addV()) to avoid duplicates
"""

import re
import logging

from boto3 import Session
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from gremlin_python.driver.driver_remote_connection import DriverRemoteConnection
from gremlin_python.process.anonymous_traversal import traversal
from gremlin_python.process.graph_traversal import __ as AnonymousTraversal

logger = logging.getLogger(__name__)


def _create_sigv4_connection(neptune_endpoint: str) -> DriverRemoteConnection:
    """Create a Gremlin connection with SigV4 IAM authentication."""
    credentials = Session().get_credentials()
    if credentials is None:
        raise RuntimeError("No AWS credentials found for Neptune IAM auth")
    creds = credentials.get_frozen_credentials()
    region = Session().region_name or "us-west-2"

    request = AWSRequest(method="GET", url=neptune_endpoint, data=None)
    SigV4Auth(creds, "neptune-db", region).add_auth(request)

    return DriverRemoteConnection(
        neptune_endpoint, "g", headers=list(request.headers.items())
    )


# Regex patterns for parsing schema docs
_TABLE_HEADER_RE = re.compile(r"^#\s+Table:\s*(.+)$", re.MULTILINE)
_FK_RE = re.compile(
    r"^-\s+(\w+)\s*→\s*(\w+)\.(\w+)\s*\((?:FK|referenced)\)",
    re.MULTILINE,
)
_EQUIV_RE = re.compile(
    r"^-\s+(\w+)\s+is\s+equivalent\s+to\s+(\w+)\.(\w+)",
    re.MULTILINE | re.IGNORECASE,
)
_COLUMN_ROW_RE = re.compile(
    r"^\|\s*(\w+)\s*\|\s*(\w+)\s*\|\s*(\w+)\s*\|",
    re.MULTILINE,
)


def _parse_table_name(doc: str) -> str | None:
    """Extract the full table name from the # Table: header."""
    match = _TABLE_HEADER_RE.search(doc)
    if match:
        return match.group(1).strip()
    return None


def _parse_columns(doc: str) -> list[dict]:
    """Extract columns from the Columns markdown table.

    Returns list of dicts with keys: name, type, nullable.
    """
    columns = []
    # Find the Columns section
    col_section = re.search(r"^##\s+Columns\s*$", doc, re.MULTILINE | re.IGNORECASE)
    if not col_section:
        return columns

    start = col_section.end()
    next_section = re.search(r"^##\s+", doc[start:], re.MULTILINE)
    end = start + next_section.start() if next_section else len(doc)
    section_text = doc[start:end]

    for match in _COLUMN_ROW_RE.finditer(section_text):
        name, col_type, nullable = match.group(1), match.group(2), match.group(3)
        # Skip the header row
        if name.lower() == "column" and col_type.lower() == "type":
            continue
        # Skip separator rows
        if set(name) <= {"-", " "}:
            continue
        columns.append(
            {
                "name": name,
                "type": col_type,
                "nullable": nullable.lower() in ("yes", "true"),
            }
        )

    return columns


def _parse_relationships(doc: str) -> tuple[list[dict], list[dict]]:
    """Extract FK and equivalence relationships from the Relationships section.

    Returns (fk_list, equiv_list) where each item is a dict with
    source_col, target_table, target_col.
    """
    fks = []
    equivs = []

    rel_section = re.search(
        r"^##\s+Relationships\s*$", doc, re.MULTILINE | re.IGNORECASE
    )
    if not rel_section:
        return fks, equivs

    start = rel_section.end()
    next_section = re.search(r"^##\s+", doc[start:], re.MULTILINE)
    end = start + next_section.start() if next_section else len(doc)
    section_text = doc[start:end]

    for match in _FK_RE.finditer(section_text):
        fks.append(
            {
                "source_col": match.group(1),
                "target_table": match.group(2),
                "target_col": match.group(3),
            }
        )

    for match in _EQUIV_RE.finditer(section_text):
        equivs.append(
            {
                "source_col": match.group(1),
                "target_table": match.group(2),
                "target_col": match.group(3),
            }
        )

    return fks, equivs


def _upsert_table_vertex(g, table_name: str, store: str) -> int:
    """Upsert a Table vertex in Neptune. Returns 1 (vertex count)."""
    g.V().has("Table", "name", table_name).fold().coalesce(
        AnonymousTraversal.unfold(),
        AnonymousTraversal.addV("Table").property("name", table_name),
    ).property("node_type", "TABLE").property("store", store).next()
    return 1


def _upsert_column_vertex(
    g, col_name: str, table_name: str, col_type: str, nullable: bool
) -> int:
    """Upsert a Column vertex in Neptune. Returns 1 (vertex count)."""
    g.V().has("Column", "name", col_name).fold().coalesce(
        AnonymousTraversal.unfold(),
        AnonymousTraversal.addV("Column").property("name", col_name),
    ).property("node_type", "COLUMN").property("table", table_name).property(
        "col_type", col_type
    ).property("nullable", nullable).next()
    return 1


def _upsert_has_column_edge(g, table_name: str, col_name: str) -> int:
    """Upsert a HAS_COLUMN edge from Table to Column. Returns 1 on success, 0 on skip."""
    try:
        result = (
            g.V()
            .has("Table", "name", table_name)
            .as_("t")
            .V()
            .has("Column", "name", col_name)
            .as_("c")
            .coalesce(
                AnonymousTraversal.select("t")
                .outE("HAS_COLUMN")
                .where(AnonymousTraversal.inV().has("name", col_name)),
                AnonymousTraversal.select("t")
                .addE("HAS_COLUMN")
                .to(AnonymousTraversal.select("c")),
            )
            .toList()
        )
        return 1 if result else 0
    except Exception as e:
        logger.warning(
            "HAS_COLUMN edge upsert failed: %s → %s: %s", table_name, col_name, e
        )
        return 0


def _upsert_bidirectional_edge(
    g, label: str, src_col_name: str, tgt_col_name: str
) -> int:
    """Upsert a bidirectional edge between two Column vertices.

    Creates both forward (src→tgt) and reverse (tgt→src) edges.
    Skips if either vertex doesn't exist. Returns edge count created.
    """
    edges_created = 0

    # Forward edge: check both vertices exist, then add edge if missing
    try:
        result = (
            g.V()
            .has("Column", "name", src_col_name)
            .as_("s")
            .V()
            .has("Column", "name", tgt_col_name)
            .as_("t")
            .coalesce(
                AnonymousTraversal.select("s")
                .outE(label)
                .where(AnonymousTraversal.inV().has("name", tgt_col_name)),
                AnonymousTraversal.select("s")
                .addE(label)
                .to(AnonymousTraversal.select("t")),
            )
            .toList()
        )
        if result:
            edges_created += 1
    except StopIteration:
        logger.warning(
            "Skipping forward edge — vertex not found: %s → %s",
            src_col_name,
            tgt_col_name,
        )
    except Exception as e:
        logger.warning(
            "Forward edge upsert failed: %s → %s: %s", src_col_name, tgt_col_name, e
        )

    # Reverse edge
    try:
        result = (
            g.V()
            .has("Column", "name", tgt_col_name)
            .as_("s")
            .V()
            .has("Column", "name", src_col_name)
            .as_("t")
            .coalesce(
                AnonymousTraversal.select("s")
                .outE(label)
                .where(AnonymousTraversal.inV().has("name", src_col_name)),
                AnonymousTraversal.select("s")
                .addE(label)
                .to(AnonymousTraversal.select("t")),
            )
            .toList()
        )
        if result:
            edges_created += 1
    except StopIteration:
        logger.warning(
            "Skipping reverse edge — vertex not found: %s → %s",
            tgt_col_name,
            src_col_name,
        )
    except Exception as e:
        logger.warning(
            "Reverse edge upsert failed: %s → %s: %s", tgt_col_name, src_col_name, e
        )

    return edges_created


def _sync_table(
    g, table_name: str, columns: list[dict], fks: list[dict], equivs: list[dict]
) -> tuple[int, int]:
    """Upsert all vertices and edges for a single table.

    Returns (nodes_written, edges_written).
    """
    nodes = 0
    edges = 0

    # Derive store name from the table's schema prefix (e.g. "liveops")
    store = table_name.split(".")[0] if "." in table_name else table_name

    # Upsert Table vertex
    nodes += _upsert_table_vertex(g, table_name, store)

    # Upsert Column vertices + HAS_COLUMN edges
    for col in columns:
        col_name = f"{table_name}.{col['name']}"
        nodes += _upsert_column_vertex(
            g, col_name, table_name, col["type"], col["nullable"]
        )
        edges += _upsert_has_column_edge(g, table_name, col_name)

    # Upsert bidirectional JOINS_ON edges for FK relationships
    for fk in fks:
        src_col_name = f"{table_name}.{fk['source_col']}"
        # Qualify target table with store prefix if not already qualified
        tgt_table = fk["target_table"]
        if "." not in tgt_table and store:
            tgt_table = f"{store}.{tgt_table}"
        tgt_col_name = f"{tgt_table}.{fk['target_col']}"
        edges += _upsert_bidirectional_edge(g, "JOINS_ON", src_col_name, tgt_col_name)

    # Upsert bidirectional EQUIVALENT_TO edges
    for equiv in equivs:
        src_col_name = f"{table_name}.{equiv['source_col']}"
        # Qualify target table with store prefix if not already qualified
        tgt_table = equiv["target_table"]
        if "." not in tgt_table and store:
            tgt_table = f"{store}.{tgt_table}"
        tgt_col_name = f"{tgt_table}.{equiv['target_col']}"
        edges += _upsert_bidirectional_edge(
            g, "EQUIVALENT_TO", src_col_name, tgt_col_name
        )

    return nodes, edges


def sync_graph(neptune_endpoint: str, docs: list[dict]) -> dict:
    """Parse schema docs and upsert the graph in Neptune.

    Args:
        neptune_endpoint: Neptune Gremlin WebSocket URL
            (e.g. wss://host:8182/gremlin).
        docs: List of dicts with keys 'key' (S3 key) and 'content'
            (markdown text).

    Returns:
        dict with keys: tables_processed, nodes_written, edges_written.

    Raises:
        Exception: On Neptune connection failure (does not affect KB
            re-ingestion — the caller catches this).
    """
    connection = None
    try:
        import socket

        # Quick connectivity check — parse host from wss:// URL and test TCP
        host = neptune_endpoint.replace("wss://", "").split(":")[0]
        port = int(neptune_endpoint.split(":")[-1].split("/")[0])
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        try:
            sock.connect((host, port))
            sock.close()
        except (socket.timeout, OSError) as e:
            sock.close()
            raise ConnectionError(f"Neptune not reachable at {host}:{port}: {e}")

        connection = _create_sigv4_connection(neptune_endpoint)
        g = traversal().withRemote(connection)

        total_nodes = 0
        total_edges = 0
        tables_processed = 0

        for doc_info in docs:
            content = doc_info.get("content", "")
            table_name = _parse_table_name(content)
            if not table_name:
                logger.warning(
                    "Could not extract table name from doc: %s",
                    doc_info.get("key", "?"),
                )
                continue

            columns = _parse_columns(content)
            fks, equivs = _parse_relationships(content)
            nodes, edges = _sync_table(g, table_name, columns, fks, equivs)

            total_nodes += nodes
            total_edges += edges
            tables_processed += 1

            logger.info(
                "Graph synced for table",
                extra={
                    "table_name": table_name,
                    "nodes": nodes,
                    "edges": edges,
                },
            )

        return {
            "tables_processed": tables_processed,
            "nodes_written": total_nodes,
            "edges_written": total_edges,
        }
    except Exception:
        logger.exception("Neptune graph sync failed")
        raise
    finally:
        if connection:
            try:
                connection.close()
            except Exception:
                logger.warning("Failed to close Neptune connection", exc_info=True)
