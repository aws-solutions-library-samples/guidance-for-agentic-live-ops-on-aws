# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
Entity Resolution Tools

Provides @tool functions for querying entity resolution links in Neptune Serverless.
Resolves text mentions to matched TABLE/COLUMN vertices via MENTIONS edges from
Document vertices, returning confidence scores and source document paths.

Usage:
  tools = create_entity_resolution_tools()
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
from gremlin_python.process.traversal import TextP
from strands import tool

logger = logging.getLogger(__name__)

NEPTUNE_ENDPOINT = os.environ.get("NEPTUNE_ENDPOINT", "")

# Lazy-initialized Gremlin connection
_connection = None
_g = None

# Artifact collection for frontend data sources panel
_entity_link_artifacts: list[dict] = []
_entity_artifact_lock = threading.Lock()


def _thread_safe_append_entity(item: dict) -> None:
    """Append an artifact to _entity_link_artifacts under a lock for thread safety."""
    with _entity_artifact_lock:
        _entity_link_artifacts.append(item)


def get_entity_link_artifacts() -> list[dict]:
    """Return collected entity link artifacts for the sources event."""
    return list(_entity_link_artifacts)


def clear_entity_link_artifacts() -> None:
    """Clear collected entity link artifacts between requests."""
    _entity_link_artifacts.clear()


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
        except Exception:
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


def create_entity_resolution_tools():
    """Create entity resolution tools for the agent runtime."""

    @tool
    def resolve_entity(mention: str) -> str:
        """Query Neptune for entity resolution links matching a text mention.

        Searches for Document vertices connected via MENTIONS edges to TABLE or COLUMN
        vertices whose names contain the given mention text. Returns matched entities
        with confidence scores and source document paths.

        Args:
            mention: Text mention to resolve (e.g. "player revenue", "DAU metrics")

        Returns:
            str: Formatted string with matched tables/columns, source documents,
                 and confidence scores, or a message if no matches found.
        """
        if not NEPTUNE_ENDPOINT:
            return "Entity resolution is not configured. NEPTUNE_ENDPOINT environment variable is not set."

        if not mention or not mention.strip():
            return "Please provide a text mention to resolve."

        mention = mention.strip()

        try:

            def _query():
                g = _get_traversal()

                # Query Document -> MENTIONS -> TABLE/COLUMN where entity name contains mention
                raw_results = (
                    g.V()
                    .hasLabel("Document")
                    .as_("doc")
                    .outE("MENTIONS")
                    .as_("e")
                    .inV()
                    .has("name", TextP.containing(mention))
                    .as_("entity")
                    .select("doc", "e", "entity")
                    .by(__.valueMap("name", "source_path"))
                    .by(__.valueMap("confidence"))
                    .by(__.valueMap("name", "node_type"))
                    .toList()
                )

                return raw_results

            results = _execute_with_retry(_query)

            if not results:
                return f'No resolved entities found for mention: "{mention}"'

            # Format results and collect artifacts
            lines = [f'**Entity resolution for "{mention}":**\n']

            for row in results:
                doc_info = row.get("doc", {}) if isinstance(row, dict) else {}
                edge_info = row.get("e", {}) if isinstance(row, dict) else {}
                entity_info = row.get("entity", {}) if isinstance(row, dict) else {}

                # Extract values (valueMap returns lists for each property)
                doc_name = _extract_property(doc_info, "name")
                source_path = _extract_property(doc_info, "source_path")
                confidence = _extract_property(edge_info, "confidence")
                entity_name = _extract_property(entity_info, "name")
                entity_type = _extract_property(entity_info, "node_type")

                # Format confidence as float
                try:
                    confidence_val = float(confidence) if confidence else 0.0
                except (ValueError, TypeError):
                    confidence_val = 0.0

                lines.append(
                    f"  • {entity_name} ({entity_type}) — confidence: {confidence_val:.2f}\n"
                    f"    Source: {doc_name} ({source_path})"
                )

                _thread_safe_append_entity(
                    {
                        "document_name": str(doc_name or ""),
                        "matched_entity": str(entity_name or ""),
                        "entity_type": str(entity_type or ""),
                        "confidence": confidence_val,
                        "source_path": str(source_path or ""),
                    }
                )

            return "\n".join(lines)

        except Exception as e:
            logger.error("resolve_entity failed: %s", e)
            _reset_connection()
            return (
                f"Entity resolution service is unavailable. "
                f"Neptune endpoint: {NEPTUNE_ENDPOINT}. "
                f"Error: {e}. Please try again later."
            )

    return [resolve_entity]


def _extract_property(value_map: dict, key: str):
    """Extract a property value from a Gremlin valueMap result.

    valueMap returns properties as lists (e.g. {'name': ['players']}),
    so this helper unwraps the first element.
    """
    val = value_map.get(key)
    if isinstance(val, list) and len(val) > 0:
        return val[0]
    return val
