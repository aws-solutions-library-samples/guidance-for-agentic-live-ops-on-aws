# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
Pattern Detector Lambda

Processes Kinesis game event batches, updates sliding window counters in DynamoDB,
and triggers the Analysis Runner when a pattern rule threshold is breached.

Event format expected from Kinesis:
{
    "event_type": "battle_error" | "session_end" | "purchase" | "login" | "logout" | ...,
    "player_id": "player_0001",
    "timestamp": "2025-02-22T10:00:00Z",
    "platform": "android" | "ios",
    "region": "KR" | "US" | ...,
    "details": { ... }  # event-specific payload
}
"""

import os
import json
import time
import base64
import boto3
from collections import defaultdict
from aws_lambda_powertools import Logger

logger = Logger(service="pattern-detector")

LIVE_METRICS_TABLE = os.environ["LIVE_METRICS_TABLE"]
PATTERN_RULES_TABLE = os.environ["PATTERN_RULES_TABLE"]
METRICS_SUMMARY_TABLE = os.environ.get("METRICS_SUMMARY_TABLE", "")
ANALYSIS_RUNNER_FUNCTION = os.environ.get("ANALYSIS_RUNNER_FUNCTION", "")

dynamodb = boto3.resource("dynamodb")
live_metrics = dynamodb.Table(LIVE_METRICS_TABLE)
pattern_rules = dynamodb.Table(PATTERN_RULES_TABLE)
metrics_summary = (
    dynamodb.Table(METRICS_SUMMARY_TABLE) if METRICS_SUMMARY_TABLE else None
)
lambda_client = boto3.client("lambda")

# Window size in seconds (1-minute buckets)
WINDOW_SIZE = 60
# TTL: keep metrics for 24 hours
METRICS_TTL = 86400

# Default rules used when the rules table is empty
DEFAULT_RULES = [
    {
        "rule_id": "battle_error_spike",
        "event_type": "battle_error",
        "threshold": 100,
        "window_minutes": 2,
        "description": "Battle error rate exceeds 100 per 90 seconds",
        "analysis_prompt": "Battle error rate has spiked. Analyze the pattern, affected platforms/regions, and recommend fixes.",
    },
    {
        "rule_id": "session_drop_spike",
        "event_type": "session_drop",
        "threshold": 200,
        "window_minutes": 2,
        "description": "Abnormal session drops detected (200+ in 90s)",
        "analysis_prompt": "Session drop rate is abnormally high. Identify affected player segments and potential causes.",
    },
    {
        "rule_id": "purchase_failure_spike",
        "event_type": "purchase_failure",
        "threshold": 50,
        "window_minutes": 2,
        "description": "Purchase failures exceeding 50 in 90 seconds",
        "analysis_prompt": "Purchase failure rate is elevated. Analyze payment methods, platforms, and revenue impact.",
    },
    {
        "rule_id": "churn_signal",
        "event_type": "churn_signal",
        "threshold": 75,
        "window_minutes": 2,
        "description": "High volume of churn signals (75+ in 90s)",
        "analysis_prompt": "Multiple churn signals detected. Analyze player segments at risk and recommend retention actions.",
    },
    {
        "rule_id": "api_abuse_spike",
        "event_type": "api_abuse",
        "threshold": 25,
        "window_minutes": 2,
        "description": "Potential API abuse or hacking attempt detected (25+ events in 90s)",
        "analysis_prompt": "API abuse pattern detected — possible brute force, credential stuffing, or DDoS. Analyze source IPs, targeted endpoints, attack types, and WAF block rates. Recommend immediate mitigation actions.",
    },
]


def get_window_key(event_type: str, timestamp: float) -> str:
    """Generate a time-bucketed key for the sliding window."""
    bucket = int(timestamp) // WINDOW_SIZE * WINDOW_SIZE
    return f"{event_type}#{bucket}"


def load_rules() -> list:
    """Load pattern rules from DynamoDB, fall back to defaults."""
    try:
        response = pattern_rules.scan()
        items = response.get("Items", [])
        if items:
            return items
    except Exception as e:
        logger.warning(f"Failed to load rules from DynamoDB: {e}")
    return DEFAULT_RULES


def update_counters(events: list) -> dict:
    """Aggregate events and update sliding window counters in DynamoDB. Returns current counts."""
    now = time.time()
    counts = defaultdict(lambda: defaultdict(int))

    for event in events:
        event_type = event.get("event_type", "unknown")
        platform = event.get("platform", "unknown")
        region = event.get("region", "unknown")
        window_key = get_window_key(event_type, now)

        counts[window_key]["total"] += 1
        counts[window_key][f"platform#{platform}"] += 1
        counts[window_key][f"region#{region}"] += 1

    # Batch update DynamoDB
    current_totals = {}
    for window_key, dimensions in counts.items():
        for dimension, count in dimensions.items():
            try:
                resp = live_metrics.update_item(
                    Key={"metric_key": window_key, "dimension": dimension},
                    UpdateExpression="ADD event_count :inc SET #ttl = :ttl, updated_at = :now",
                    ExpressionAttributeNames={"#ttl": "ttl"},
                    ExpressionAttributeValues={
                        ":inc": count,
                        ":ttl": int(now) + METRICS_TTL,
                        ":now": int(now),
                    },
                    ReturnValues="UPDATED_NEW",
                )
                if dimension == "total":
                    event_type = window_key.split("#")[0]
                    new_count = int(resp["Attributes"]["event_count"])
                    current_totals[event_type] = (
                        current_totals.get(event_type, 0) + new_count
                    )
            except Exception as e:
                logger.error(f"Failed to update counter {window_key}/{dimension}: {e}")

    return current_totals


def update_summary(events: list, current_totals: dict):
    """Write pre-aggregated summary rows to the metrics summary table.

    One row per event_type with total count and platform/region breakdowns.
    The monitor API reads this instead of scanning the full live_metrics table.
    """
    if not metrics_summary:
        return

    now = time.time()

    # Aggregate platform/region from this batch
    batch_breakdowns = defaultdict(
        lambda: {"platforms": defaultdict(int), "regions": defaultdict(int)}
    )
    for event in events:
        event_type = event.get("event_type", "unknown")
        platform = event.get("platform", "unknown")
        region = event.get("region", "unknown")
        batch_breakdowns[event_type]["platforms"][platform] += 1
        batch_breakdowns[event_type]["regions"][region] += 1

    for event_type, total in current_totals.items():
        try:
            breakdown = batch_breakdowns.get(
                event_type, {"platforms": {}, "regions": {}}
            )

            # Build atomic update expression for platform/region counters
            update_parts = ["SET #total = :total, updated_at = :now, #ttl = :ttl"]
            attr_names = {"#total": "total", "#ttl": "ttl"}
            attr_values = {
                ":total": total,
                ":now": int(now),
                ":ttl": int(now) + METRICS_TTL,
            }

            # Atomically increment platform counters
            for i, (platform, count) in enumerate(breakdown["platforms"].items()):
                safe_key = f"p_{platform.replace('-', '_')}"
                update_parts.append(
                    f"platforms.#pk{i} = if_not_exists(platforms.#pk{i}, :zero) + :pv{i}"
                )
                attr_names[f"#pk{i}"] = safe_key
                attr_values[f":pv{i}"] = count

            # Atomically increment region counters
            for i, (region, count) in enumerate(breakdown["regions"].items()):
                safe_key = f"r_{region.replace('-', '_')}"
                update_parts.append(
                    f"regions.#rk{i} = if_not_exists(regions.#rk{i}, :zero) + :rv{i}"
                )
                attr_names[f"#rk{i}"] = safe_key
                attr_values[f":rv{i}"] = count

            attr_values[":zero"] = 0

            # Simpler approach: overwrite the summary with current snapshot
            metrics_summary.put_item(
                Item={
                    "event_type": event_type,
                    "total": total,
                    "platforms": dict(breakdown["platforms"]),
                    "regions": dict(breakdown["regions"]),
                    "updated_at": int(now),
                    "ttl": int(now) + METRICS_TTL,
                }
            )

        except Exception as e:
            logger.error(f"Failed to update summary for {event_type}: {e}")


def check_rules(current_totals: dict, rules: list) -> list:
    """Check if any pattern rules are breached. Returns list of triggered rules."""
    triggered = []
    for rule in rules:
        event_type = rule.get("event_type", "")
        threshold = int(rule.get("threshold", 0))
        current = current_totals.get(event_type, 0)

        if current >= threshold:
            triggered.append(
                {
                    "rule": rule,
                    "current_count": current,
                    "threshold": threshold,
                }
            )
            logger.info(
                f"Rule triggered: {rule['rule_id']} — {current}/{threshold}",
                extra={
                    "rule_id": rule["rule_id"],
                    "current": current,
                    "threshold": threshold,
                },
            )

    return triggered


# In-memory cooldown tracker removed — now persisted in DynamoDB (pattern_rules table)
# so cooldown survives Lambda cold starts and container recycling.
AUTO_REPORT_COOLDOWN = 3600  # 1 hour in seconds


def _try_acquire_report_lock(rule_id: str, now: float) -> bool:
    """Atomically check and set the cooldown timestamp.

    Uses a DynamoDB conditional update so only ONE concurrent Lambda
    invocation wins the lock. All others get ConditionalCheckFailedException
    and skip the report.

    Returns True if this invocation acquired the lock (should fire report).
    """
    cutoff = int(now - AUTO_REPORT_COOLDOWN)
    try:
        pattern_rules.update_item(
            Key={"rule_id": rule_id},
            UpdateExpression="SET last_auto_report_at = :now",
            ConditionExpression=(
                "attribute_not_exists(last_auto_report_at) OR last_auto_report_at <= :cutoff"
            ),
            ExpressionAttributeValues={
                ":now": int(now),
                ":cutoff": cutoff,
            },
        )
        return True
    except dynamodb.meta.client.exceptions.ConditionalCheckFailedException:
        logger.info(
            f"Cooldown lock not acquired for {rule_id} — another invocation won"
        )
        return False
    except Exception as e:
        logger.warning(f"Failed to acquire report lock for {rule_id}: {e}")
        return False


def invoke_analysis(triggered_rules: list):
    """Invoke the Analysis Runner Lambda for each triggered rule (respects cooldown)."""
    if not ANALYSIS_RUNNER_FUNCTION:
        logger.warning("ANALYSIS_RUNNER_FUNCTION not set, skipping analysis invocation")
        return

    now = time.time()

    for trigger in triggered_rules:
        rule = trigger["rule"]
        rule_id = rule["rule_id"]

        # Only auto-invoke if auto_report is enabled on the rule
        if not rule.get("auto_report", False):
            logger.info(f"Auto-report disabled for {rule_id}, skipping")
            continue

        # Atomic cooldown check — only one concurrent invocation wins
        if not _try_acquire_report_lock(rule_id, now):
            remaining = AUTO_REPORT_COOLDOWN  # approximate
            logger.info(
                f"Cooldown active for {rule_id}, ~{remaining}s window. Skipping auto-report."
            )
            continue

        try:
            payload = {
                "rule_id": rule_id,
                "event_type": rule["event_type"],
                "current_count": trigger["current_count"],
                "threshold": trigger["threshold"],
                "description": rule.get("description", ""),
                "analysis_prompt": rule.get("analysis_prompt", ""),
                "triggered_at": now,
            }

            lambda_client.invoke(
                FunctionName=ANALYSIS_RUNNER_FUNCTION,
                InvocationType="Event",  # Async — don't block the detector
                Payload=json.dumps(payload),
            )

            logger.info(
                f"Auto-report triggered for {rule_id} (cooldown: {AUTO_REPORT_COOLDOWN}s, lock acquired atomically)"
            )

        except Exception as e:
            logger.error(f"Failed to invoke analysis runner: {e}")


def handler(event, context):
    """Kinesis event handler — processes game event batches."""
    records = event.get("Records", [])
    if not records:
        return {"statusCode": 200, "body": "No records"}

    # Decode Kinesis records
    game_events = []
    for record in records:
        try:
            data = base64.b64decode(record["kinesis"]["data"])
            game_event = json.loads(data)
            game_events.append(game_event)
        except Exception as e:
            logger.warning(f"Failed to decode record: {e}")

    logger.info(f"Processing {len(game_events)} game events")

    # Update sliding window counters
    current_totals = update_counters(game_events)

    # Write pre-aggregated summary for the monitor API
    update_summary(game_events, current_totals)

    # Load and check pattern rules
    rules = load_rules()
    triggered = check_rules(current_totals, rules)

    # Auto-invoke analysis for triggered rules (respects auto_report flag + 1hr cooldown)
    # Ad-hoc reports can still be requested via the dashboard at any time
    if triggered:
        for t in triggered:
            logger.info(
                f"Threshold breached: {t['rule']['rule_id']} — {t['current_count']}/{t['threshold']}"
            )
        invoke_analysis(triggered)

    return {
        "statusCode": 200,
        "body": json.dumps(
            {
                "processed": len(game_events),
                "triggered_rules": len(triggered),
            }
        ),
    }
