# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
Real-Time Monitor Tools

Provides @tool functions for the orchestrator to query live game metrics
and proactive analysis reports. These let users ask about real-time
patterns through the chat interface.
"""

import os
import time
import threading
import boto3
from aws_lambda_powertools import Logger
from strands import Agent, tool
from strands.models import BedrockModel
from common.reasoning_emitter import emit_agent, emit_error

from tools.athena_query import create_athena_tools

import json

logger = Logger(service="realtime-monitor-tools", level=os.getenv("LOG_LEVEL", "DEBUG"))

LIVE_METRICS_TABLE = os.getenv("LIVE_METRICS_TABLE", "")
REPORTS_TABLE = os.getenv("REPORTS_TABLE", "")
AWS_REGION = os.getenv("BEDROCK_REGION", "us-west-2")
MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "us.anthropic.claude-haiku-4-5-20251001-v1:0")

# Resolve realtime_monitor model from MODEL_CONFIG JSON
_model_config_raw = os.getenv("MODEL_CONFIG", "{}")
try:
    _model_config = json.loads(_model_config_raw)
except json.JSONDecodeError:
    _model_config = {}
REALTIME_MONITOR_MODEL_ID = _model_config.get("agents", {}).get(
    "realtime_monitor", _model_config.get("defaultModelId", MODEL_ID)
)

# Window size must match pattern_detector.py
WINDOW_SIZE = 60

# Global collector for live metrics artifacts (reset per request)
_live_metrics_artifacts = []
_live_metrics_artifact_lock = threading.Lock()


def get_live_metrics_artifacts():
    """Return collected live metrics artifacts."""
    with _live_metrics_artifact_lock:
        return list(_live_metrics_artifacts)


def clear_live_metrics_artifacts():
    """Clear collected live metrics artifacts."""
    with _live_metrics_artifact_lock:
        _live_metrics_artifacts.clear()


def _get_live_metrics_table():
    if not LIVE_METRICS_TABLE:
        return None
    return boto3.resource("dynamodb", region_name=AWS_REGION).Table(LIVE_METRICS_TABLE)


def _get_reports_table():
    if not REPORTS_TABLE:
        return None
    return boto3.resource("dynamodb", region_name=AWS_REGION).Table(REPORTS_TABLE)


def create_realtime_tools():
    """Create real-time monitoring tools for the orchestrator."""

    @tool
    def query_live_metrics(event_type: str, time_range_minutes: int = 30) -> str:
        """Query real-time game metrics from the live metrics table.
        Use this to check current game health, error rates, session drops, or purchase failures.

        Args:
            event_type: Type of metric (battle_error, session_drop, purchase_failure, churn_signal, login, logout, purchase, session_end)
            time_range_minutes: How far back to look (default 30 min)

        Returns:
            str: Aggregated metrics with breakdowns by platform and region
        """
        table = _get_live_metrics_table()
        if not table:
            return (
                "Real-time metrics not available — LIVE_METRICS_TABLE not configured."
            )

        try:
            now = time.time()
            start_bucket = (
                int(now - time_range_minutes * 60) // WINDOW_SIZE * WINDOW_SIZE
            )

            total_count = 0
            platform_counts = {}
            region_counts = {}
            bucket_time = start_bucket

            while bucket_time <= int(now) // WINDOW_SIZE * WINDOW_SIZE:
                window_key = f"{event_type}#{bucket_time}"
                try:
                    response = table.query(
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

            result = f"**Real-Time Metrics: {event_type}** (last {time_range_minutes} min)\n\n"
            result += f"Total events: {total_count}\n\n"

            if platform_counts:
                result += "**By Platform:**\n"
                for platform, count in sorted(
                    platform_counts.items(), key=lambda x: -x[1]
                ):
                    pct = round(count / total_count * 100, 1) if total_count > 0 else 0
                    result += f"  - {platform}: {count} ({pct}%)\n"
                result += "\n"

            if region_counts:
                result += "**By Region:**\n"
                for region, count in sorted(region_counts.items(), key=lambda x: -x[1]):
                    pct = round(count / total_count * 100, 1) if total_count > 0 else 0
                    result += f"  - {region}: {count} ({pct}%)\n"

            # Collect artifact for sources event (always track the query, even with zero results)
            with _live_metrics_artifact_lock:
                _live_metrics_artifacts.append(
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
    def get_recent_reports(limit: int = 5) -> str:
        """Get recent proactive analysis reports generated by the real-time monitoring system.
        Use this when users ask about recent alerts, anomalies, or what the monitoring system has detected.

        Args:
            limit: Maximum number of reports to return (default 5)

        Returns:
            str: Formatted list of recent analysis reports
        """
        table = _get_reports_table()
        if not table:
            return "Reports not available — REPORTS_TABLE not configured."

        try:
            # Scan for recent reports (sorted by created_at desc)
            response = table.scan(Limit=limit * 3)  # Over-fetch to allow sorting
            items = response.get("Items", [])

            if not items:
                return "📋 No analysis reports have been generated yet. The monitoring system will create reports when it detects anomalous patterns in real-time game data."

            # Sort by created_at descending and take top N
            items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
            items = items[:limit]

            result = "📋 **Recent Proactive Analysis Reports:**\n\n"
            for item in items:
                result += f"**Report:** {item.get('report_id', 'N/A')}\n"
                result += f"**Time:** {item.get('created_at', 'N/A')}\n"
                result += f"**Rule:** {item.get('rule_id', 'N/A')} ({item.get('event_type', 'N/A')})\n"
                analysis = item.get("analysis", "No analysis available")
                # Truncate long analyses for the list view
                if len(analysis) > 500:
                    analysis = analysis[:500] + "..."
                result += f"**Analysis:** {analysis}\n\n---\n\n"

            return result

        except Exception as e:
            logger.error(f"Failed to get reports: {e}")
            return f"Error retrieving reports: {e}"

    return [query_live_metrics, get_recent_reports]


@tool
def realtime_monitor_agent(query: str) -> str:
    """
    Real-Time Monitor Agent - Analyzes live game telemetry and recent proactive alerts.
    Use this agent for questions about current game health, real-time error rates,
    active anomalies, recent alerts, or live player behavior patterns.

    Args:
        query (str): Question about real-time game metrics, alerts, or live patterns

    Returns:
        str: Real-time analysis with live data and recent alert context
    """
    try:
        agent_start_time = time.time()

        emit_agent(
            agent_name="Real-Time Monitor Agent",
            query=query,
            result="",
            metadata={
                "agent_type": "realtime_monitor",
                "status": "invoking",
                "model_id": REALTIME_MONITOR_MODEL_ID,
            },
        )

        logger.info("Initializing Real-Time Monitor Agent", extra={"query": query})

        tools = create_realtime_tools() + create_athena_tools()

        agent = Agent(
            model=BedrockModel(
                model_id=REALTIME_MONITOR_MODEL_ID,
                region_name=AWS_REGION,
                temperature=0.3,
            ),
            system_prompt=(
                "You are a real-time game analytics monitor. You have access to live game telemetry "
                "metrics, proactive analysis reports, and archived historical data via Athena SQL queries. "
                "Use query_live_metrics to check current event rates, get_recent_reports to see what "
                "the automated monitoring has detected, and query_data to compare against "
                "historical baselines. Call search_schema if you need to discover available tables and columns. "
                "Be concise, data-driven, and actionable. Compare current metrics against historical "
                "patterns. NEVER ask questions — provide facts and recommendations only."
            ),
            tools=tools,
        )

        result = str(agent(query))

        agent_duration = time.time() - agent_start_time
        emit_agent(
            agent_name="Real-Time Monitor Agent",
            query=query,
            result=result,
            metadata={
                "agent_type": "realtime_monitor",
                "status": "completed",
                "duration_ms": round(agent_duration * 1000, 2),
                "model_id": REALTIME_MONITOR_MODEL_ID,
            },
        )

        return result

    except Exception as e:
        logger.error(f"Real-Time Monitor Agent failed: {e}", extra={"query": query})
        emit_error(
            f"Real-Time Monitor Agent encountered an error: {e}",
            error_type="agent_error",
            metadata={"agent_name": "Real-Time Monitor Agent", "error_details": str(e)},
        )
        return f"Real-Time Monitor Agent Error: {e}"
