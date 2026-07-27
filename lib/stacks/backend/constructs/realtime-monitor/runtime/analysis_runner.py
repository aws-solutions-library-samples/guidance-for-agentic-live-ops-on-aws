# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
Analysis Runner Lambda

Invoked by the Pattern Detector when a threshold is breached.
Queries DynamoDB LiveMetrics for real-time data, queries the KB for historical context,
runs a Strands agent to generate an analysis report, then stores the report.
"""

import os
import json
import time
import uuid
import boto3
from aws_lambda_powertools import Logger
from strands import Agent, tool
from strands.models import BedrockModel

logger = Logger(service="analysis-runner")

LIVE_METRICS_TABLE = os.environ["LIVE_METRICS_TABLE"]
REPORTS_TABLE = os.environ["REPORTS_TABLE"]
KB_ID = os.environ.get("BEDROCK_KB_ID", "")
REMEDIATIONS_KB_ID = os.environ.get("REMEDIATIONS_KB_ID", "")
MODEL_ID = os.environ.get(
    "BEDROCK_MODEL_ID", "us.anthropic.claude-haiku-4-5-20251001-v1:0"
)
AWS_REGION = os.environ.get("BEDROCK_REGION", "us-west-2")
ATHENA_DATABASE = os.environ.get("ATHENA_DATABASE", "")
ATHENA_WORKGROUP = os.environ.get("ATHENA_WORKGROUP", "")

dynamodb = boto3.resource("dynamodb")
live_metrics = dynamodb.Table(LIVE_METRICS_TABLE)
reports_table = dynamodb.Table(REPORTS_TABLE)

# Window size must match pattern_detector.py
WINDOW_SIZE = 60

# Reports TTL: 30 days
REPORTS_TTL = 30 * 24 * 3600

# Collect tool artifacts during analysis
_artifacts = {
    "data_points": [],
    "kb_sources": [],
    "athena_queries": [],
    "remediation_sources": [],
}


def get_bedrock_model():
    return BedrockModel(model_id=MODEL_ID, region_name=AWS_REGION, temperature=0.3)


@tool
def query_live_metrics(event_type: str, time_range_minutes: int = 30) -> str:
    """Query real-time game metrics from the live metrics table.

    Args:
        event_type: Type of metric (battle_error, session_drop, purchase_failure, etc.)
        time_range_minutes: How far back to look (default 30 min)

    Returns:
        str: Aggregated metrics with breakdowns by platform and region
    """
    try:
        now = time.time()
        start_bucket = int(now - time_range_minutes * 60) // WINDOW_SIZE * WINDOW_SIZE

        # Query all window buckets in the time range
        total_count = 0
        platform_counts = {}
        region_counts = {}
        bucket_time = start_bucket

        while bucket_time <= int(now) // WINDOW_SIZE * WINDOW_SIZE:
            window_key = f"{event_type}#{bucket_time}"
            try:
                response = live_metrics.query(
                    KeyConditionExpression=boto3.dynamodb.conditions.Key(
                        "metric_key"
                    ).eq(window_key)
                )
                for item in response.get("Items", []):
                    dim = item.get("dimension", "")
                    count = int(item.get("event_count", 0))

                    if dim == "total":
                        total_count += count
                    elif dim.startswith("platform#"):
                        platform = dim.split("#", 1)[1]
                        platform_counts[platform] = (
                            platform_counts.get(platform, 0) + count
                        )
                    elif dim.startswith("region#"):
                        region = dim.split("#", 1)[1]
                        region_counts[region] = region_counts.get(region, 0) + count
            except Exception as e:
                logger.warning(f"Failed to query window {window_key}: {e}")

            bucket_time += WINDOW_SIZE

        # Format results
        result = (
            f"**Real-Time Metrics: {event_type}** (last {time_range_minutes} min)\n\n"
        )
        result += f"Total events: {total_count}\n\n"

        if platform_counts:
            result += "**By Platform:**\n"
            for platform, count in sorted(platform_counts.items(), key=lambda x: -x[1]):
                pct = round(count / total_count * 100, 1) if total_count > 0 else 0
                result += f"  - {platform}: {count} ({pct}%)\n"
            result += "\n"

        if region_counts:
            result += "**By Region:**\n"
            for region, count in sorted(region_counts.items(), key=lambda x: -x[1]):
                pct = round(count / total_count * 100, 1) if total_count > 0 else 0
                result += f"  - {region}: {count} ({pct}%)\n"

        # Capture as artifact
        _artifacts["data_points"].append(
            {
                "event_type": event_type,
                "time_range_minutes": time_range_minutes,
                "total_count": total_count,
                "platforms": platform_counts,
                "regions": region_counts,
            }
        )

        return (
            result
            if total_count > 0
            else f"No {event_type} events found in the last {time_range_minutes} minutes."
        )

    except Exception as e:
        logger.error(f"Failed to query live metrics: {e}")
        return f"Error querying live metrics: {e}"


@tool
def query_knowledge_base(query: str) -> str:
    """Query the Bedrock Knowledge Base for historical context and baselines.

    Args:
        query: Natural language query about historical game data patterns

    Returns:
        str: Relevant historical data and context from the knowledge base
    """
    if not KB_ID:
        return "Knowledge base not configured — no historical context available."

    try:
        client = boto3.client("bedrock-agent-runtime", region_name=AWS_REGION)
        response = client.retrieve(
            knowledgeBaseId=KB_ID,
            retrievalQuery={"text": query},
            retrievalConfiguration={
                "vectorSearchConfiguration": {
                    "numberOfResults": 10,
                    "overrideSearchType": "SEMANTIC",
                }
            },
        )

        results = response.get("retrievalResults", [])
        texts = []
        for i, r in enumerate(results):
            score = r.get("score", 0)
            if score >= 0.3:
                content = r.get("content", {}).get("text", "")
                source_uri = r.get("location", {}).get("s3Location", {}).get("uri", "")
                if content:
                    texts.append(
                        f"[Historical Source {i + 1}] (Relevance: {score:.2f})\n{content}"
                    )
                    # Capture as artifact
                    _artifacts["kb_sources"].append(
                        {
                            "source_index": i + 1,
                            "relevance_score": round(score, 2),
                            "content": content,  # Full content
                            "source_uri": source_uri,
                        }
                    )

        if texts:
            return "**Historical Context from Knowledge Base:**\n\n" + "\n\n".join(
                texts[:5]
            )
        return "No relevant historical data found in knowledge base."

    except Exception as e:
        logger.error(f"KB retrieval failed: {e}")
        return f"Knowledge base query failed: {e}"


@tool
def query_remediations(event_type: str) -> str:
    """Query the Remediations Knowledge Base for recommended fixes and playbooks.

    Args:
        event_type: The type of event/alert to find remediations for (e.g., battle_error, session_drop, purchase_failure, churn_signal, api_abuse)

    Returns:
        str: Remediation steps, root causes, and preventive measures from the playbook
    """
    if not REMEDIATIONS_KB_ID:
        return "Remediations knowledge base not configured."

    try:
        client = boto3.client("bedrock-agent-runtime", region_name=AWS_REGION)
        query = f"{event_type.replace('_', ' ')} remediation root cause fix"
        response = client.retrieve(
            knowledgeBaseId=REMEDIATIONS_KB_ID,
            retrievalQuery={"text": query},
            retrievalConfiguration={
                "vectorSearchConfiguration": {
                    "numberOfResults": 5,
                    "overrideSearchType": "SEMANTIC",
                }
            },
        )

        results = response.get("retrievalResults", [])
        texts = []
        for i, r in enumerate(results):
            score = r.get("score", 0)
            if score >= 0.25:
                content = r.get("content", {}).get("text", "")
                source_uri = r.get("location", {}).get("s3Location", {}).get("uri", "")
                if content:
                    texts.append(
                        f"[Remediation {i + 1}] (Relevance: {score:.2f})\n{content}"
                    )
                    _artifacts["remediation_sources"].append(
                        {
                            "source_index": i + 1,
                            "relevance_score": round(score, 2),
                            "content": content[:500],
                            "source_uri": source_uri,
                        }
                    )

        if texts:
            return "**Recommended Remediations:**\n\n" + "\n\n".join(texts[:3])
        return "No matching remediations found in playbook."

    except Exception as e:
        logger.error(f"Remediations KB query failed: {e}")
        return f"Remediations query failed: {e}"


# Athena schema reference for SQL generation
_ATHENA_TABLES = {
    "players": "player_id, username, player_level, arena_rank, combat_power, guild_id, country, platform, segment",
    "session_details": "session_id, player_id, session_start_time, session_end_time, session_duration_minutes, device_model, platform, network_type, session_quality_score",
    "purchases": "purchase_id, player_id, purchase_date, item_name, item_category, price_usd, payment_method, transaction_status, platform, country",
    "monetization_events": "transaction_id, player_id, transaction_timestamp, purchase_type, item_considered, amount_usd, purchase_decision, payment_method, segment_classification",
    "arena_battles": "battle_id, player_id, battle_type, battle_timestamp, battle_result, team_power_used, battle_duration_seconds",
    "gameplay": "gameplay_id, player_id, session_date, game_mode, duration_minutes, battles_fought, battles_won, experience_gained",
    "incidents": "incident_id, incident_type, severity, start_time, resolution_time, affected_players, description, resolution_status",
    "user_acquisition": "acquisition_id, player_id, install_date, acquisition_channel, cost_per_install, lifetime_value, retention_d1, retention_d7, retention_d30",
}


def _run_athena_query(sql: str, timeout_seconds: int = 30) -> dict:
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

        start = time.time()
        while time.time() - start < timeout_seconds:
            status = athena.get_query_execution(QueryExecutionId=query_id)
            state = status["QueryExecution"]["Status"]["State"]
            if state == "SUCCEEDED":
                break
            if state in ("FAILED", "CANCELLED"):
                reason = status["QueryExecution"]["Status"].get(
                    "StateChangeReason", "Unknown"
                )
                return {"error": f"Query {state}: {reason}"}
            time.sleep(1)
        else:
            return {"error": f"Query timed out after {timeout_seconds}s"}

        results = athena.get_query_results(QueryExecutionId=query_id, MaxResults=200)
        rows = results.get("ResultSet", {}).get("Rows", [])
        if not rows:
            return {"columns": [], "rows": [], "row_count": 0}

        columns = [col.get("VarCharValue", "") for col in rows[0].get("Data", [])]
        data_rows = [
            [cell.get("VarCharValue", "") for cell in row.get("Data", [])]
            for row in rows[1:]
        ]
        return {"columns": columns, "rows": data_rows, "row_count": len(data_rows)}
    except Exception as e:
        logger.error(f"Athena error: {e}")
        return {"error": str(e)}


@tool
def query_historical_data(sql: str) -> str:
    """Query historical data from Athena for deeper analysis context.

    Available tables (database: liveops):
      - players: profiles, levels, segments, countries, platforms
      - session_details: session telemetry, devices, quality scores
      - purchases: completed transactions, items, prices
      - monetization_events: purchase decisions, amounts, payment methods
      - arena_battles: PvP results, power, duration
      - gameplay: sessions, modes, battles, experience
      - incidents: outages, bugs, severity, compensation
      - user_acquisition: UA channels, CPI, LTV, retention cohorts

    Use string comparisons for dates: WHERE purchase_date >= '2024-01-01'
    Always use LIMIT to keep results manageable.

    Args:
        sql: A valid SQL query against the liveops database

    Returns:
        str: Query results formatted as a text table
    """
    if not ATHENA_DATABASE or not ATHENA_WORKGROUP:
        return "Athena not configured — ATHENA_DATABASE or ATHENA_WORKGROUP not set."

    logger.info("Analysis Runner executing Athena query", extra={"sql": sql[:200]})
    results = _run_athena_query(sql, timeout_seconds=30)

    if "error" in results:
        return f"Query error: {results['error']}"

    if results["row_count"] == 0:
        # Still capture the query attempt as artifact
        _artifacts["athena_queries"].append(
            {
                "sql": sql,
                "row_count": 0,
                "columns": [],
                "sample_rows": [],
            }
        )
        return "Query returned no results."

    # Format as text table
    columns = results["columns"]
    rows = results["rows"]
    lines = [" | ".join(columns), "-" * len(" | ".join(columns))]
    for row in rows[:50]:
        lines.append(" | ".join(str(v) for v in row))
    truncated = (
        f"\n... ({results['row_count']} total rows)"
        if results["row_count"] > 50
        else ""
    )

    # Capture as artifact
    _artifacts["athena_queries"].append(
        {
            "sql": sql,
            "row_count": results["row_count"],
            "columns": columns,
            "sample_rows": rows[:20],  # Cap at 20 rows for artifact storage
        }
    )

    return "\n".join(lines) + truncated


def save_report(
    report_id: str,
    rule_id: str,
    event_type: str,
    analysis: str,
    trigger_context: dict,
    current_count: int = 0,
    threshold: int = 0,
    artifacts: dict = None,
):
    """Save the analysis report to DynamoDB with severity and artifacts."""
    now = time.time()
    ratio = current_count / threshold if threshold > 0 else 0
    severity = "error" if ratio >= 1 else "warning" if ratio >= 0.7 else "success"

    item = {
        "report_id": report_id,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
        "gsi_pk": "ALL",
        "rule_id": rule_id,
        "event_type": event_type,
        "analysis": analysis,
        "trigger_context": json.dumps(trigger_context),
        "severity": severity,
        "current_count": current_count,
        "threshold": threshold,
        "ttl": int(now) + REPORTS_TTL,
    }

    if artifacts:
        item["artifacts"] = json.dumps(artifacts)

    try:
        reports_table.put_item(Item=item)
        logger.info(f"Report saved: {report_id} (severity: {severity})")
    except Exception as e:
        logger.error(f"Failed to save report: {e}")


def handler(event, context):
    """Invoked async by Pattern Detector when a rule threshold is breached."""
    rule_id = event.get("rule_id", "unknown")
    event_type = event.get("event_type", "unknown")
    current_count = event.get("current_count", 0)
    threshold = event.get("threshold", 0)
    description = event.get("description", "")
    analysis_prompt = event.get("analysis_prompt", "")
    window_minutes = event.get("window_minutes", 2)

    logger.info(
        f"Analysis triggered for rule: {rule_id}",
        extra={
            "event_type": event_type,
            "current_count": current_count,
            "threshold": threshold,
        },
    )

    # Reset artifacts for this run
    _artifacts["data_points"] = []
    _artifacts["kb_sources"] = []
    _artifacts["athena_queries"] = []
    _artifacts["remediation_sources"] = []

    # Build the agent prompt with trigger context
    prompt = (
        f"A real-time pattern has been detected in the game telemetry.\n\n"
        f"**Alert:** {description}\n"
        f"**Event Type:** {event_type}\n"
        f"**Current Count:** {current_count} (threshold: {threshold})\n"
        f"**Time Window:** {window_minutes} minute(s)\n\n"
        f"**Your Task:** {analysis_prompt}\n\n"
        f"IMPORTANT: Use the query_live_metrics tool with time_range_minutes={window_minutes} "
        f"to get data from the exact monitoring window that triggered this alert. "
        f"Also query with time_range_minutes=30 for a broader baseline comparison. "
        f"Use the query_knowledge_base tool to compare against historical baselines. "
        f"Use the query_remediations tool with event_type='{event_type}' to find recommended fixes from the remediation playbook. "
        f"Use the query_historical_data tool to run SQL queries against the Athena data warehouse for deeper historical context "
        f"(e.g., affected player segments, purchase patterns, session trends). "
        f"Provide a concise analysis with:\n"
        f"1. What's happening (data-driven summary)\n"
        f"2. Likely root cause\n"
        f"3. Impact assessment\n"
        f"4. Recommended remediations (from the playbook)\n"
        f"5. Preventive measures\n"
    )

    try:
        agent = Agent(
            model=get_bedrock_model(),
            system_prompt=(
                "You are a real-time game analytics monitor. You analyze live game telemetry "
                "patterns and compare them against historical baselines. You have access to both "
                "real-time DynamoDB metrics and historical Athena data warehouse queries. "
                "Be concise, data-driven, and actionable. Never ask questions — provide facts "
                "and recommendations only."
            ),
            tools=[
                query_live_metrics,
                query_knowledge_base,
                query_remediations,
                query_historical_data,
            ],
        )

        result = str(agent(prompt))

        # Save report
        report_id = f"report_{uuid.uuid4().hex[:12]}"
        trigger_context = {
            "rule_id": rule_id,
            "event_type": event_type,
            "current_count": current_count,
            "threshold": threshold,
            "description": description,
            "window_minutes": window_minutes,
            "analyzed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        save_report(
            report_id,
            rule_id,
            event_type,
            result,
            trigger_context,
            current_count,
            threshold,
            _artifacts,
        )

        logger.info(f"Analysis complete for rule: {rule_id}, report: {report_id}")

        return {
            "statusCode": 200,
            "body": json.dumps({"report_id": report_id, "rule_id": rule_id}),
        }

    except Exception as e:
        logger.error(f"Analysis failed for rule {rule_id}: {e}")
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(e), "rule_id": rule_id}),
        }
