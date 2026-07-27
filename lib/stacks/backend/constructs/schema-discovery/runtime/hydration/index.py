# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Hydration Lambda — daily job that checks for updated schema docs
and re-indexes the Bedrock Knowledge Base.

Triggered by an EventBridge scheduled rule. Lists all .md files in the
schema-docs bucket, compares LastModified timestamps against the stored
hydration state in DynamoDB, and triggers KB re-ingestion when updates
are detected.
"""

import os
import datetime
import time

import boto3
from aws_lambda_powertools import Logger

logger = Logger(service="hydration")

DOCS_BUCKET = os.environ.get("DOCS_BUCKET", "")
SCHEMA_KB_ID = os.environ.get("SCHEMA_KB_ID", "")
HYDRATION_TABLE = os.environ.get("HYDRATION_TABLE", "")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "")

# Neptune endpoint — resolve from SSM parameter if not set directly
_NEPTUNE_ENDPOINT_DIRECT = os.environ.get("NEPTUNE_ENDPOINT", "")
_NEPTUNE_ENDPOINT_SSM_PARAM = os.environ.get("NEPTUNE_ENDPOINT_SSM_PARAM", "")


def _resolve_neptune_endpoint() -> str:
    """Resolve Neptune endpoint from direct env var or SSM parameter."""
    if _NEPTUNE_ENDPOINT_DIRECT:
        return _NEPTUNE_ENDPOINT_DIRECT
    if not _NEPTUNE_ENDPOINT_SSM_PARAM:
        logger.info("No Neptune endpoint configured — graph sync will be skipped")
        return ""
    try:
        ssm = boto3.client("ssm")
        response = ssm.get_parameter(Name=_NEPTUNE_ENDPOINT_SSM_PARAM)
        hostname = response["Parameter"]["Value"]
        endpoint = f"wss://{hostname}:8182/gremlin"
        logger.info("Resolved Neptune endpoint from SSM", extra={"endpoint": endpoint})
        return endpoint
    except Exception:
        logger.exception("Failed to resolve Neptune endpoint from SSM")
        return ""


NEPTUNE_ENDPOINT = _resolve_neptune_endpoint()

s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")
bedrock_agent = boto3.client("bedrock-agent")

# Files to exclude when listing docs
_EXCLUDED_FILES = {"_manifest.json", "_glossary.md"}


def _get_hydration_state() -> dict:
    """Read the hydration state record from DynamoDB.

    Returns a dict with keys: last_hydration_timestamp, last_doc_count,
    last_ingestion_job_id.  Falls back to sensible defaults when no
    record exists yet.
    """
    table = dynamodb.Table(HYDRATION_TABLE)
    response = table.get_item(Key={"pk": "hydration-state"})
    item = response.get("Item")

    if not item:
        logger.info("No existing hydration state — first run")
        return {
            "last_hydration_timestamp": "1970-01-01T00:00:00+00:00",
            "last_doc_count": 0,
            "last_ingestion_job_id": "",
        }

    return {
        "last_hydration_timestamp": item.get(
            "last_hydration_timestamp", "1970-01-01T00:00:00+00:00"
        ),
        "last_doc_count": int(item.get("last_doc_count", 0)),
        "last_ingestion_job_id": item.get("last_ingestion_job_id", ""),
    }


def _list_docs_with_timestamps(bucket: str) -> list[dict]:
    """List all .md files in the docs bucket with their LastModified timestamps.

    Excludes ``_manifest.json`` and ``_glossary.md``.

    Returns:
        List of dicts with keys ``key`` (str) and ``last_modified`` (datetime).
    """
    docs: list[dict] = []
    paginator = s3.get_paginator("list_objects_v2")

    for page in paginator.paginate(Bucket=bucket):
        for obj in page.get("Contents", []):
            key: str = obj["Key"]
            filename = key.rsplit("/", 1)[-1] if "/" in key else key

            # Only include .md files, skip excluded files
            if not key.endswith(".md"):
                continue
            if filename in _EXCLUDED_FILES:
                continue

            docs.append(
                {
                    "key": key,
                    "last_modified": obj["LastModified"],
                }
            )

    logger.info("Listed docs in bucket", extra={"doc_count": len(docs)})
    return docs


def _has_updates(docs: list[dict], last_timestamp: str) -> bool:
    """Return True if any doc has LastModified strictly newer than *last_timestamp*.

    Handles timezone-aware comparison: S3 LastModified is always
    timezone-aware (UTC), and the stored timestamp is ISO 8601.
    """
    if not docs:
        return False

    threshold = datetime.datetime.fromisoformat(last_timestamp)

    # Ensure threshold is timezone-aware for comparison
    if threshold.tzinfo is None:
        threshold = threshold.replace(tzinfo=datetime.timezone.utc)

    for doc in docs:
        doc_modified = doc["last_modified"]
        # S3 LastModified is already timezone-aware, but guard just in case
        if doc_modified.tzinfo is None:
            doc_modified = doc_modified.replace(tzinfo=datetime.timezone.utc)

        if doc_modified > threshold:
            return True

    return False


def _start_ingestion_job() -> str | None:
    """Start a KB ingestion job with exponential backoff retry.

    Looks up the first data source for the schema KB, then calls
    StartIngestionJob.  Retries up to 3 times with exponential backoff
    (1s, 2s, 4s) on failure.

    Returns:
        The ingestion job ID on success, or None if all retries fail.
    """
    max_attempts = 3
    base_delay = 1  # seconds

    # Resolve the data source ID for the KB
    try:
        ds_response = bedrock_agent.list_data_sources(knowledgeBaseId=SCHEMA_KB_ID)
        data_sources = ds_response.get("dataSourceSummaries", [])
        if not data_sources:
            logger.error("No data sources found for KB", extra={"kb_id": SCHEMA_KB_ID})
            return None
        data_source_id = data_sources[0]["dataSourceId"]
    except Exception:
        logger.exception("Failed to list data sources for KB")
        return None

    for attempt in range(1, max_attempts + 1):
        try:
            response = bedrock_agent.start_ingestion_job(
                knowledgeBaseId=SCHEMA_KB_ID,
                dataSourceId=data_source_id,
            )
            job_id = response["ingestionJob"]["ingestionJobId"]
            logger.info(
                "KB ingestion job started",
                extra={"job_id": job_id, "attempt": attempt},
            )
            return job_id
        except Exception:
            delay = base_delay * (2 ** (attempt - 1))
            logger.warning(
                "StartIngestionJob failed — retrying",
                extra={
                    "attempt": attempt,
                    "max_attempts": max_attempts,
                    "retry_delay_s": delay,
                },
                exc_info=True,
            )
            if attempt < max_attempts:
                time.sleep(delay)

    logger.error(
        "KB re-indexing failed after all retry attempts",
        extra={"max_attempts": max_attempts, "kb_id": SCHEMA_KB_ID},
    )
    return None


def _update_hydration_state(doc_count: int, ingestion_job_id: str) -> None:
    """Write updated hydration state to DynamoDB.

    Stores the current UTC timestamp, doc count, and ingestion job ID.
    """
    table = dynamodb.Table(HYDRATION_TABLE)
    table.put_item(
        Item={
            "pk": "hydration-state",
            "last_hydration_timestamp": datetime.datetime.now(
                datetime.timezone.utc
            ).isoformat(),
            "last_doc_count": doc_count,
            "last_ingestion_job_id": ingestion_job_id,
        }
    )
    logger.info(
        "Hydration state updated",
        extra={"doc_count": doc_count, "ingestion_job_id": ingestion_job_id},
    )


def check_and_hydrate(event: dict) -> dict:
    """Main orchestrator — check for updated docs and trigger KB re-indexing.

    Steps:
        1. Read hydration state from DynamoDB
        2. List all docs with timestamps from S3
        3. Compare against last_hydration_timestamp
        4. If no updates → return early (skip re-indexing)
        5. If updates found → count them, then trigger KB re-indexing

    Returns:
        dict with keys: updated_docs, total_docs, skipped,
        and optionally ingestion_job_id.
    """
    # 1. Get hydration state
    state = _get_hydration_state()
    last_timestamp = state["last_hydration_timestamp"]
    logger.info(
        "Hydration state loaded",
        extra={
            "last_timestamp": last_timestamp,
            "last_doc_count": state["last_doc_count"],
        },
    )

    # 2. List all docs with timestamps
    docs = _list_docs_with_timestamps(DOCS_BUCKET)

    # 3. Check for updates
    has_new = _has_updates(docs, last_timestamp)
    force = event.get("force_graph_sync", False) or event.get("force", False)

    if not has_new and not force:
        logger.info(
            "No docs updated since last hydration — skipping KB re-indexing",
            extra={"total_docs": len(docs), "last_timestamp": last_timestamp},
        )
        return {
            "updated_docs": 0,
            "total_docs": len(docs),
            "skipped": True,
        }

    if force and not has_new:
        logger.info("Force flag set — running graph sync despite no doc updates")

    # 4. Count updated docs
    threshold = datetime.datetime.fromisoformat(last_timestamp)
    if threshold.tzinfo is None:
        threshold = threshold.replace(tzinfo=datetime.timezone.utc)

    updated_count = sum(
        1
        for doc in docs
        if (
            doc["last_modified"].replace(tzinfo=datetime.timezone.utc)
            if doc["last_modified"].tzinfo is None
            else doc["last_modified"]
        )
        > threshold
    )

    logger.info(
        "Updates detected — triggering KB re-indexing",
        extra={"updated_docs": updated_count, "total_docs": len(docs)},
    )

    # 5. Trigger KB re-indexing (skip if force-only with no real updates)
    ingestion_job_id = None
    if has_new:
        ingestion_job_id = _start_ingestion_job()

    # 6. Sync schema graph (Neptune)
    graph_result = {}
    updated_docs = []
    if NEPTUNE_ENDPOINT:
        try:
            from graph_sync import sync_graph

            # Read updated doc contents for graph parsing
            for doc in docs:
                try:
                    resp = s3.get_object(Bucket=DOCS_BUCKET, Key=doc["key"])
                    content = resp["Body"].read().decode("utf-8")
                    updated_docs.append({"key": doc["key"], "content": content})
                except Exception:
                    logger.warning("Failed to read doc for graph sync: %s", doc["key"])

            if updated_docs:
                graph_result = sync_graph(NEPTUNE_ENDPOINT, updated_docs)
                logger.info("Graph sync complete", extra={"graph_result": graph_result})
        except Exception:
            logger.exception("Graph sync failed — continuing with KB-only hydration")

    # 7. Entity resolution (link document mentions to graph vertices)
    entity_result = {}
    if NEPTUNE_ENDPOINT and BEDROCK_MODEL_ID and updated_docs:
        try:
            from entity_resolution import resolve_entities

            entity_result = resolve_entities(
                NEPTUNE_ENDPOINT, updated_docs, BEDROCK_MODEL_ID
            )
            logger.info(
                "Entity resolution complete",
                extra={"entity_result": entity_result},
            )
        except Exception:
            logger.exception(
                "Entity resolution failed — continuing without entity links"
            )

    if ingestion_job_id or force:
        if ingestion_job_id:
            _update_hydration_state(
                doc_count=len(docs), ingestion_job_id=ingestion_job_id
            )
        result = {
            "updated_docs": updated_count,
            "total_docs": len(docs),
            "skipped": False,
            "forced": force and not has_new,
        }
        if ingestion_job_id:
            result["ingestion_job_id"] = ingestion_job_id
        if graph_result:
            result["graph_sync"] = graph_result
        if entity_result:
            result["entity_resolution"] = entity_result
        return result

    # All retries failed — preserve existing hydration state
    logger.error("KB re-indexing failed — hydration state NOT updated")
    return {
        "updated_docs": updated_count,
        "total_docs": len(docs),
        "skipped": False,
        "error": "KB re-indexing failed after 3 attempts",
    }


@logger.inject_lambda_context(log_event=True)
def handler(event: dict, context: object) -> dict:
    """Lambda entry point — triggered by EventBridge daily schedule."""
    try:
        result = check_and_hydrate(event)
        logger.info("Hydration complete", extra={"result": result})
        return {"statusCode": 200, "body": result}
    except Exception:
        logger.exception(
            "Hydration failed", extra={"request_id": context.aws_request_id}
        )
        return {
            "statusCode": 500,
            "body": {
                "error": f"Internal server error. Reference ID: {context.aws_request_id}"
            },
        }
