# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Entity resolution module — extracts entity mentions from unstructured
documents and links them to TABLE/COLUMN vertices in Neptune.

Called by the hydration Lambda after graph sync completes. For each document,
uses a Bedrock LLM to extract entity mentions (table names, column names,
metric names), then matches them against existing graph vertices using
multi-signal similarity (exact, partial, glossary alias). Creates MENTIONS
edges for high-confidence matches and logs unresolved mentions for review.

Graph model additions:
  Vertex label: Document (name, category, source_path)
  Edge label: MENTIONS (confidence) — Document → Table or Column
"""

import json
import logging
import re

import boto3
from boto3 import Session
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from gremlin_python.driver.driver_remote_connection import DriverRemoteConnection
from gremlin_python.process.anonymous_traversal import traversal
from gremlin_python.process.graph_traversal import __ as AnonymousTraversal

logger = logging.getLogger(__name__)

bedrock_runtime = boto3.client("bedrock-runtime")

# Confidence thresholds
CONFIDENCE_THRESHOLD = 0.7
EXACT_MATCH_SCORE = 1.0
PARTIAL_MATCH_SCORE = 0.8
GLOSSARY_ALIAS_SCORE = 0.7

# Category mapping from S3 key path prefixes
_CATEGORY_MAP = {
    "kb-insights": "kb-summary",
    "kb-remediations": "remediation",
    "kb-schema-docs": "schema-doc",
}

# LLM prompt for entity extraction
_EXTRACTION_PROMPT = """Extract all entity mentions from the following document.
Entity mentions include: database table names, column names, metric names,
and any references to data fields or analytics concepts.

Return a JSON array of objects with these fields:
- "mention": the exact text mention found in the document
- "type": one of "table", "column", or "metric"

Only return the JSON array, no other text.

Document:
{content}"""


def _derive_category(s3_key: str) -> str:
    """Derive document category from S3 key path prefix.

    Examples:
        "kb-insights/summary.md" → "kb-summary"
        "kb-remediations/playbook.md"   → "remediation"
        "kb-schema-docs/tables.md"      → "schema-doc"
    """
    for prefix, category in _CATEGORY_MAP.items():
        if prefix in s3_key:
            return category
    return "schema-doc"


def _derive_doc_name(s3_key: str) -> str:
    """Derive a human-readable document name from the S3 key.

    Strips the directory prefix and .md extension.
    """
    filename = s3_key.rsplit("/", 1)[-1] if "/" in s3_key else s3_key
    if filename.endswith(".md"):
        filename = filename[:-3]
    return filename


def _extract_entities_via_llm(content: str, model_id: str) -> list[dict]:
    """Call Bedrock LLM to extract entity mentions from document content.

    Args:
        content: Document text content.
        model_id: Bedrock model ID for invocation.

    Returns:
        List of dicts with keys 'mention' and 'type'.
        Returns empty list on failure.
    """
    prompt = _EXTRACTION_PROMPT.format(content=content[:8000])

    try:
        body = json.dumps(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 2048,
                "messages": [{"role": "user", "content": prompt}],
            }
        )

        response = bedrock_runtime.invoke_model(
            modelId=model_id,
            contentType="application/json",
            accept="application/json",
            body=body,
        )

        response_body = json.loads(response["body"].read())
        raw_text = response_body.get("content", [{}])[0].get("text", "")

        # Extract JSON array from response (handle markdown code blocks)
        json_match = re.search(r"\[.*\]", raw_text, re.DOTALL)
        if not json_match:
            logger.warning("LLM returned no parseable JSON array")
            return []

        entities = json.loads(json_match.group())
        if not isinstance(entities, list):
            return []

        # Validate each entity has required fields
        valid = []
        for entity in entities:
            if isinstance(entity, dict) and "mention" in entity and "type" in entity:
                valid.append(
                    {
                        "mention": str(entity["mention"]).strip(),
                        "type": str(entity["type"]).strip().lower(),
                    }
                )
        return valid

    except json.JSONDecodeError:
        logger.warning("LLM returned unparseable JSON response", exc_info=True)
        return []
    except Exception:
        logger.exception("Bedrock model invocation failed")
        return []


def _upsert_document_vertex(g, name: str, category: str, source_path: str) -> None:
    """Upsert a Document vertex in Neptune."""
    g.V().has("Document", "name", name).fold().coalesce(
        AnonymousTraversal.unfold(),
        AnonymousTraversal.addV("Document").property("name", name),
    ).property("category", category).property("source_path", source_path).next()


def _find_matching_vertices(g, mention: str) -> list[dict]:
    """Query Neptune for TABLE/COLUMN vertices matching a mention.

    Uses multi-signal similarity:
      - Exact match on vertex name (score=1.0)
      - Partial match — mention appears in vertex name (score=0.8)
      - Glossary alias — vertex name's last segment matches mention (score=0.7)

    Returns list of dicts with keys: name, node_type, label, confidence.
    Sorted by confidence descending.
    """
    candidates = []

    mention_lower = mention.lower().strip()
    if not mention_lower:
        return candidates

    # Query all Table and Column vertices
    try:
        table_vertices = (
            g.V()
            .hasLabel("Table")
            .project("name", "node_type", "label")
            .by("name")
            .by("node_type")
            .by(AnonymousTraversal.label())
            .toList()
        )
    except Exception:
        table_vertices = []

    try:
        column_vertices = (
            g.V()
            .hasLabel("Column")
            .project("name", "node_type", "label")
            .by("name")
            .by("node_type")
            .by(AnonymousTraversal.label())
            .toList()
        )
    except Exception:
        column_vertices = []

    all_vertices = table_vertices + column_vertices

    for vertex in all_vertices:
        v_name = str(vertex.get("name", "")).lower()
        v_node_type = str(vertex.get("node_type", ""))
        v_label = str(vertex.get("label", ""))

        if not v_name:
            continue

        confidence = 0.0

        # Exact match: mention equals vertex name
        if mention_lower == v_name:
            confidence = EXACT_MATCH_SCORE
        # Partial match: mention is contained in vertex name or vice versa
        elif mention_lower in v_name or v_name in mention_lower:
            confidence = PARTIAL_MATCH_SCORE
        else:
            # Glossary alias: last segment of vertex name matches mention
            # e.g. "liveops.players.player_id" → "player_id"
            segments = v_name.split(".")
            last_segment = segments[-1] if segments else ""
            if last_segment and (
                mention_lower == last_segment
                or mention_lower.replace(" ", "_") == last_segment
                or mention_lower.replace("_", " ") == last_segment
            ):
                confidence = GLOSSARY_ALIAS_SCORE

        if confidence > 0:
            candidates.append(
                {
                    "name": vertex.get("name", ""),
                    "node_type": v_node_type,
                    "label": v_label,
                    "confidence": confidence,
                }
            )

    # Sort by confidence descending
    candidates.sort(key=lambda c: c["confidence"], reverse=True)
    return candidates


def _create_mentions_edge(
    g, doc_name: str, target_name: str, target_label: str, confidence: float
) -> None:
    """Create a MENTIONS edge from a Document vertex to a target vertex."""
    g.V().has("Document", "name", doc_name).as_("d").V().has(
        target_label, "name", target_name
    ).as_("t").coalesce(
        AnonymousTraversal.select("d")
        .outE("MENTIONS")
        .where(AnonymousTraversal.inV().as_("t")),
        AnonymousTraversal.select("d")
        .addE("MENTIONS")
        .to(AnonymousTraversal.select("t")),
    ).property("confidence", confidence).next()


def resolve_entities(neptune_endpoint: str, docs: list[dict], model_id: str) -> dict:
    """Extract entity mentions from docs and create MENTIONS edges in Neptune.

    For each document:
      1. Call Bedrock LLM to extract entity mentions
      2. Create a Document vertex in Neptune
      3. Match mentions against TABLE/COLUMN vertices
      4. Create MENTIONS edges for high-confidence matches (> 0.7)
      5. Log unresolved mentions for manual review

    Args:
        neptune_endpoint: Neptune Gremlin WebSocket URL
            (e.g. wss://host:8182/gremlin).
        docs: List of dicts with keys 'key' (S3 key) and 'content'
            (document text). Optionally 'category' if pre-classified.
        model_id: Bedrock model ID for LLM entity extraction.

    Returns:
        dict with keys: docs_processed, entities_resolved, unresolved.
        The 'unresolved' value is a list of dicts with mention, best_candidate,
        best_confidence, and doc_name.
    """
    connection = None
    try:
        # Create SigV4-authenticated connection to Neptune
        credentials = Session().get_credentials()
        if credentials is None:
            raise RuntimeError("No AWS credentials found for Neptune IAM auth")
        creds = credentials.get_frozen_credentials()
        region = Session().region_name or "us-west-2"
        request = AWSRequest(method="GET", url=neptune_endpoint, data=None)
        SigV4Auth(creds, "neptune-db", region).add_auth(request)
        connection = DriverRemoteConnection(
            neptune_endpoint, "g", headers=list(request.headers.items())
        )
        g = traversal().withRemote(connection)

        docs_processed = 0
        entities_resolved = 0
        unresolved: list[dict] = []
        errors: list[dict] = []

        for doc in docs:
            s3_key = doc.get("key", "")
            content = doc.get("content", "")
            category = doc.get("category") or _derive_category(s3_key)
            doc_name = _derive_doc_name(s3_key)

            if not content.strip():
                logger.info("Skipping empty document: %s", s3_key)
                continue

            # Step 1: Extract entities via LLM
            mentions = _extract_entities_via_llm(content, model_id)
            if mentions is None:
                errors.append({"doc": s3_key, "error": "LLM extraction failed"})
                continue

            # Step 2: Create Document vertex
            try:
                _upsert_document_vertex(g, doc_name, category, s3_key)
            except Exception:
                logger.exception("Failed to create Document vertex for %s", s3_key)
                errors.append(
                    {"doc": s3_key, "error": "Document vertex creation failed"}
                )
                continue

            docs_processed += 1

            if not mentions:
                logger.info("No entity mentions found in document: %s", s3_key)
                continue

            # Step 3-5: Match mentions and create edges
            for mention_info in mentions:
                mention_text = mention_info.get("mention", "")
                if not mention_text:
                    continue

                candidates = _find_matching_vertices(g, mention_text)

                if not candidates:
                    unresolved.append(
                        {
                            "mention": mention_text,
                            "best_candidate": None,
                            "best_confidence": 0.0,
                            "doc_name": doc_name,
                        }
                    )
                    logger.info(
                        "Unresolved mention (no candidates): '%s' in %s",
                        mention_text,
                        doc_name,
                    )
                    continue

                best = candidates[0]

                if best["confidence"] > CONFIDENCE_THRESHOLD:
                    # Create MENTIONS edge
                    try:
                        _create_mentions_edge(
                            g,
                            doc_name,
                            best["name"],
                            best["label"],
                            best["confidence"],
                        )
                        entities_resolved += 1
                        logger.info(
                            "Resolved entity",
                            extra={
                                "mention": mention_text,
                                "target": best["name"],
                                "confidence": best["confidence"],
                                "doc": doc_name,
                            },
                        )
                    except Exception:
                        logger.exception(
                            "Failed to create MENTIONS edge: %s → %s",
                            doc_name,
                            best["name"],
                        )
                else:
                    # Log for manual review
                    unresolved.append(
                        {
                            "mention": mention_text,
                            "best_candidate": best["name"],
                            "best_confidence": best["confidence"],
                            "doc_name": doc_name,
                        }
                    )
                    logger.info(
                        "Unresolved mention (low confidence): '%s' → '%s' (%.2f) in %s",
                        mention_text,
                        best["name"],
                        best["confidence"],
                        doc_name,
                    )

        result = {
            "docs_processed": docs_processed,
            "entities_resolved": entities_resolved,
            "unresolved": unresolved,
        }
        if errors:
            result["errors"] = errors

        logger.info("Entity resolution complete", extra={"result": result})
        return result

    except Exception:
        logger.exception("Entity resolution failed")
        return {
            "docs_processed": 0,
            "entities_resolved": 0,
            "unresolved": [],
            "error": "Entity resolution failed — see logs",
        }
    finally:
        if connection:
            try:
                connection.close()
            except Exception:
                logger.warning("Failed to close Neptune connection", exc_info=True)
