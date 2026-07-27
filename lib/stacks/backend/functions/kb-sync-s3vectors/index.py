# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
KB Sync Lambda — exports last 24h of DynamoDB data to CSV, uploads to S3,
then triggers a Bedrock KB ingestion job to rehydrate embeddings.
"""

import csv
import io
import json
import os
import time
import boto3
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

WINDOW_HOURS = 24


def _read_csv_from_s3(s3_client, bucket: str, key: str) -> list:
    """Read a CSV file from S3 and return list of dicts."""
    try:
        response = s3_client.get_object(Bucket=bucket, Key=key)
        content = response["Body"].read().decode("utf-8")
        reader = csv.DictReader(io.StringIO(content))
        return list(reader)
    except Exception as e:
        logger.warning(f"Could not read {key}: {e}")
        return []


def _collect_all_csv_data(s3_client, bucket: str, prefix: str = "kb/") -> dict:
    """Collect all CSV data from S3 bucket, merging base + realtime files by type."""
    from collections import defaultdict

    data = defaultdict(list)

    paginator = s3_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if not key.endswith(".csv"):
                continue
            # Determine data type from filename (e.g. kb_players, kb_incidents_realtime_*)
            filename = key.split("/")[-1]
            # Normalize: kb_players.csv and kb_players_realtime_2025-01-01.csv → "players"
            base = filename.replace(".csv", "")
            for suffix in (
                ["_realtime_" + base.split("_realtime_")[-1]]
                if "_realtime_" in base
                else [""]
            ):
                pass
            data_type = base.split("_realtime_")[0].replace("kb_", "")
            rows = _read_csv_from_s3(s3_client, bucket, key)
            data[data_type].extend(rows)
            logger.info(f"Loaded {len(rows)} rows from {key} → {data_type}")

    return dict(data)


def generate_summaries(s3_client, bucket: str) -> list:
    """Generate markdown summary documents from all KB CSV data and upload to S3."""
    from collections import defaultdict

    data = _collect_all_csv_data(s3_client, bucket)
    uploaded = []

    def _upload_md(name: str, content: str):
        key = f"kb/summaries/{name}"
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=content.encode("utf-8"),
            ContentType="text/markdown",
        )
        uploaded.append(key)
        logger.info(f"Uploaded summary: {key}")

    # --- Player Segments ---
    players = data.get("players", [])
    if players:
        segments = defaultdict(list)
        for p in players:
            segments[p.get("segment", "unknown")].append(p)

        lines = ["# Player Segments Analysis\n", f"Total players: {len(players)}\n"]
        for seg_name in ["whale", "dolphin", "f2p_hardcore", "casual"]:
            seg = segments.get(seg_name, [])
            if not seg:
                continue
            levels = [int(p.get("player_level", 0)) for p in seg]
            cp = [int(p.get("combat_power", 0)) for p in seg]
            ranks = [int(p.get("arena_rank", 0)) for p in seg]
            chars = [int(p.get("characters_owned", 0)) for p in seg]
            legendary = [int(p.get("legendary_heroes_owned", 0)) for p in seg]
            countries = defaultdict(int)
            platforms = defaultdict(int)
            guilds = defaultdict(int)
            for p in seg:
                countries[p.get("country", "")] += 1
                platforms[p.get("platform", "")] += 1
                guilds[p.get("guild_id", "")] += 1

            lines.append(f"## {seg_name.upper()} Segment\n")
            lines.append(f"- Count: {len(seg)}")
            lines.append(f"- Avg level: {sum(levels) / len(levels):.1f}")
            lines.append(f"- Avg combat power: {sum(cp) / len(cp):,.0f}")
            lines.append(f"- Avg arena rank: {sum(ranks) / len(ranks):,.0f}")
            lines.append(f"- Avg characters owned: {sum(chars) / len(chars):.1f}")
            lines.append(
                f"- Avg legendary heroes: {sum(legendary) / len(legendary):.1f}"
            )
            lines.append(f"- Combat power range: {min(cp):,} to {max(cp):,}")
            lines.append(
                f"- Countries: {dict(sorted(countries.items(), key=lambda x: -x[1]))}"
            )
            lines.append(f"- Platforms: {dict(platforms)}")
            lines.append(
                f"- Top guilds: {dict(sorted(guilds.items(), key=lambda x: -x[1])[:5])}"
            )
            top = sorted(
                seg, key=lambda x: int(x.get("combat_power", 0)), reverse=True
            )[:5]
            lines.append(f"\n### Top {seg_name} players:")
            for p in top:
                lines.append(
                    f"- {p.get('player_id', '')} ({p.get('username', '')}) — Level {p.get('player_level')}, "
                    f"CP {int(p.get('combat_power', 0)):,}, Rank {p.get('arena_rank')}, "
                    f"{p.get('characters_owned')} chars, {p.get('legendary_heroes_owned')} legendary, "
                    f"Guild: {p.get('guild_id')}, {p.get('country')}, {p.get('platform')}"
                )
            lines.append("")
        _upload_md("player_segments_analysis.md", "\n".join(lines))

        # Country analysis
        country_data = defaultdict(list)
        for p in players:
            country_data[p.get("country", "unknown")].append(p)
        clines = ["# Player Distribution by Country\n"]
        for country in sorted(country_data.keys()):
            cp_list = country_data[country]
            segs = defaultdict(int)
            for p in cp_list:
                segs[p.get("segment", "")] += 1
            cps = [int(p.get("combat_power", 0)) for p in cp_list]
            clines.append(f"## {country}\n- Players: {len(cp_list)}")
            clines.append(f"- Segments: {dict(segs)}")
            clines.append(f"- Avg CP: {sum(cps) / len(cps):,.0f}\n")
        _upload_md("player_country_analysis.md", "\n".join(clines))

    # --- Campaigns ---
    campaigns = data.get("campaigns", [])
    acquisitions = data.get("user_acquisition", [])
    if campaigns:
        camp_acq = defaultdict(list)
        for a in acquisitions:
            camp_acq[a.get("campaign_id", "")].append(a)
        lines = ["# Campaign Performance Analysis\n"]
        for c in campaigns:
            cid = c.get("campaign_id", "")
            acqs = camp_acq.get(cid, [])
            lines.append(f"## {c.get('campaign_name', cid)} ({cid})\n")
            lines.append(
                f"- Type: {c.get('campaign_type')}, Budget: ${float(c.get('budget', 0)):,.2f}"
            )
            lines.append(
                f"- Target: {c.get('target_audience')}, Channel: {c.get('channel')}"
            )
            lines.append(
                f"- Status: {c.get('status')}, Period: {c.get('start_date')} to {c.get('end_date')}"
            )
            lines.append(f"- Acquired players: {len(acqs)}")
            if acqs:
                ltvs = [
                    float(a.get("lifetime_value", 0))
                    for a in acqs
                    if a.get("lifetime_value")
                ]
                cpis = [
                    float(a.get("cost_per_install", 0))
                    for a in acqs
                    if a.get("cost_per_install")
                ]
                d1 = sum(1 for a in acqs if a.get("retention_d1") == "True")
                d7 = sum(1 for a in acqs if a.get("retention_d7") == "True")
                d30 = sum(1 for a in acqs if a.get("retention_d30") == "True")
                if ltvs:
                    lines.append(
                        f"- Avg LTV: ${sum(ltvs) / len(ltvs):.2f}, Max: ${max(ltvs):.2f}"
                    )
                if cpis:
                    lines.append(f"- Avg CPI: ${sum(cpis) / len(cpis):.2f}")
                lines.append(
                    f"- Retention: D1={d1 / len(acqs) * 100:.0f}%, D7={d7 / len(acqs) * 100:.0f}%, D30={d30 / len(acqs) * 100:.0f}%"
                )
            lines.append("")
        _upload_md("campaign_performance_analysis.md", "\n".join(lines))

    # --- Acquisition Channels ---
    if acquisitions:
        channels = defaultdict(list)
        for a in acquisitions:
            channels[a.get("acquisition_channel", "unknown")].append(a)
        lines = ["# User Acquisition Channel Analysis\n"]
        for ch, acqs in sorted(channels.items()):
            cpis = [
                float(a.get("cost_per_install", 0))
                for a in acqs
                if a.get("cost_per_install")
            ]
            ltvs = [
                float(a.get("lifetime_value", 0))
                for a in acqs
                if a.get("lifetime_value")
            ]
            d1 = sum(1 for a in acqs if a.get("retention_d1") == "True")
            lines.append(f"## {ch}\n- Players: {len(acqs)}")
            if cpis:
                lines.append(
                    f"- Avg CPI: ${sum(cpis) / len(cpis):.2f}, Range: ${min(cpis):.2f}-${max(cpis):.2f}"
                )
            if ltvs:
                lines.append(
                    f"- Avg LTV: ${sum(ltvs) / len(ltvs):.2f}, Range: ${min(ltvs):.2f}-${max(ltvs):.2f}"
                )
            lines.append(f"- D1 retention: {d1 / len(acqs) * 100:.0f}%\n")
        _upload_md("acquisition_channels_analysis.md", "\n".join(lines))

    # --- Monetization ---
    purchases = data.get("purchases", [])
    monetization = data.get("monetization_events", [])
    if purchases or monetization:
        player_seg = {
            p.get("player_id", ""): p.get("segment", "unknown") for p in players
        }
        lines = ["# Monetization & Purchase Analysis\n"]
        if purchases:
            cats = defaultdict(list)
            for p in purchases:
                cats[p.get("item_category", "unknown")].append(p)
            lines.append("## By Item Category\n")
            for cat, txns in sorted(cats.items()):
                prices = [
                    float(t.get("price_usd", 0)) for t in txns if t.get("price_usd")
                ]
                if prices:
                    lines.append(
                        f"- {cat}: {len(txns)} txns, avg ${sum(prices) / len(prices):.2f}, total ${sum(prices):,.2f}"
                    )
            lines.append("")
            # By segment
            seg_p = defaultdict(list)
            for p in purchases:
                seg_p[player_seg.get(p.get("player_id", ""), "unknown")].append(p)
            lines.append("## By Segment\n")
            for seg in ["whale", "dolphin", "f2p_hardcore", "casual"]:
                txns = seg_p.get(seg, [])
                if txns:
                    prices = [
                        float(t.get("price_usd", 0)) for t in txns if t.get("price_usd")
                    ]
                    if prices:
                        lines.append(
                            f"- {seg}: {len(txns)} txns, avg ${sum(prices) / len(prices):.2f}, total ${sum(prices):,.2f}"
                        )
            lines.append("")
        if monetization:
            seg_events = defaultdict(
                lambda: {"purchased": 0, "declined": 0, "spend": 0.0}
            )
            for m in monetization:
                seg = m.get("segment_classification", "unknown")
                if m.get("purchase_decision") == "purchased":
                    seg_events[seg]["purchased"] += 1
                    seg_events[seg]["spend"] += float(m.get("amount_usd", 0))
                elif m.get("purchase_decision") == "declined":
                    seg_events[seg]["declined"] += 1
            lines.append("## Monetization by Segment\n")
            for seg in ["whale", "dolphin", "f2p_hardcore", "casual"]:
                d = seg_events.get(seg)
                if d:
                    total = d["purchased"] + d["declined"]
                    rate = d["purchased"] / total * 100 if total else 0
                    lines.append(
                        f"- {seg}: {d['purchased']} purchased, {d['declined']} declined, {rate:.0f}% conversion, ${d['spend']:,.2f} spend"
                    )
            lines.append("")
        _upload_md("monetization_analysis.md", "\n".join(lines))

    # --- Incidents ---
    incidents = data.get("incidents", [])
    if incidents:
        sev_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        sorted_inc = sorted(
            incidents, key=lambda x: sev_order.get(x.get("severity", ""), 99)
        )
        lines = ["# Incident Report Analysis\n", f"Total incidents: {len(incidents)}\n"]
        compensated = []
        for inc in sorted_inc:
            lines.append(
                f"## {inc.get('incident_id', '')} — {inc.get('incident_type', '')}\n"
            )
            lines.append(
                f"- Severity: {inc.get('severity')}, Affected: {inc.get('affected_players')}"
            )
            lines.append(
                f"- Status: {inc.get('resolution_status')}, Compensation: ${inc.get('compensation_amount', 0)}"
            )
            lines.append(f"- Description: {inc.get('description', '')[:300]}\n")
            if (
                inc.get("compensation_given") == "True"
                or float(inc.get("compensation_amount", 0)) > 0
            ):
                compensated.append(inc)
        if compensated:
            lines.append("## Incidents with Compensation\n")
            for inc in compensated:
                lines.append(
                    f"- {inc['incident_id']}: {inc.get('incident_type')} ({inc.get('severity')}), "
                    f"{inc.get('affected_players')} affected, ${float(inc.get('compensation_amount', 0)):,.2f}"
                )
        _upload_md("incident_analysis.md", "\n".join(lines))

    # --- Gameplay & Sessions ---
    gameplay = data.get("gameplay", [])
    sessions = data.get("session_details", [])
    if gameplay or sessions:
        lines = ["# Gameplay & Session Analysis\n"]
        if gameplay:
            modes = defaultdict(list)
            for g in gameplay:
                modes[g.get("game_mode", "unknown")].append(g)
            for mode, entries in sorted(modes.items()):
                durs = [float(e.get("duration_minutes", 0)) for e in entries]
                lines.append(
                    f"## {mode}\n- Sessions: {len(entries)}, Avg duration: {sum(durs) / len(durs):.1f} min"
                )
                lines.append(
                    f"- Duration range: {min(durs):.1f} to {max(durs):.1f} min\n"
                )
        if sessions:
            devices = defaultdict(int)
            platforms = defaultdict(int)
            for s in sessions:
                devices[s.get("device_model", "")] += 1
                platforms[s.get("platform", "")] += 1
            durs = [float(s.get("session_duration_minutes", 0)) for s in sessions]
            lines.append(
                f"## Session Overview\n- Total: {len(sessions)}, Avg duration: {sum(durs) / len(durs):.1f} min"
            )
            lines.append(
                f"- Devices: {dict(sorted(devices.items(), key=lambda x: -x[1])[:8])}"
            )
            lines.append(f"- Platforms: {dict(platforms)}\n")
        _upload_md("gameplay_session_analysis.md", "\n".join(lines))

    # --- KPI Reference ---
    lines = ["# Key Performance Indicators (KPIs) Reference\n"]
    if players:
        segs = defaultdict(int)
        for p in players:
            segs[p.get("segment", "")] += 1
        lines.append(f"## Players\n- Total: {len(players)}, Segments: {dict(segs)}\n")
    if purchases:
        comp = [p for p in purchases if p.get("transaction_status") == "completed"]
        prices = [float(p.get("price_usd", 0)) for p in comp if p.get("price_usd")]
        if prices:
            lines.append(
                f"## Revenue\n- Completed txns: {len(comp)}, Total: ${sum(prices):,.2f}"
            )
            if players:
                lines.append(f"- ARPU: ${sum(prices) / len(players):.2f}\n")
    if acquisitions:
        d1 = sum(1 for a in acquisitions if a.get("retention_d1") == "True")
        d7 = sum(1 for a in acquisitions if a.get("retention_d7") == "True")
        d30 = sum(1 for a in acquisitions if a.get("retention_d30") == "True")
        lines.append(
            f"## Retention\n- D1: {d1 / len(acquisitions) * 100:.1f}%, D7: {d7 / len(acquisitions) * 100:.1f}%, D30: {d30 / len(acquisitions) * 100:.1f}%\n"
        )
    _upload_md("kpi_reference.md", "\n".join(lines))

    logger.info(f"Generated {len(uploaded)} summary documents")
    return uploaded


def export_dynamo_to_csv(
    reports_table_name: str,
    metrics_summary_table_name: str,
    live_metrics_table_name: str,
    data_bucket: str,
) -> str:
    """
    Scan the last 24h of reports and metrics from DynamoDB.
    Produces per-table CSVs matching the existing KB schema formats,
    uploads them to S3 under kb/, and returns a summary of keys written.
    """
    dynamodb = boto3.resource("dynamodb")
    s3 = boto3.client("s3")

    cutoff_iso = (
        datetime.now(timezone.utc) - timedelta(hours=WINDOW_HOURS)
    ).isoformat()
    cutoff_ts = int(time.time()) - WINDOW_HOURS * 3600
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    uploaded_keys = []

    # --- 1. Reports → kb_incidents format ---
    # Matches: incident_id, incident_type, severity, start_time, resolution_time,
    #          affected_players, description, resolution_status, compensation_given, compensation_amount
    if reports_table_name:
        table = dynamodb.Table(reports_table_name)
        result = table.scan()
        rows = []
        for item in result.get("Items", []):
            if item.get("created_at", "") >= cutoff_iso:
                ctx = {}
                try:
                    ctx = json.loads(item.get("trigger_context", "{}"))
                except Exception:
                    pass
                rows.append(
                    {
                        "incident_id": item.get("report_id", ""),
                        "incident_type": item.get("event_type", "").replace("_", " "),
                        "severity": item.get("severity", "medium"),
                        "start_time": item.get("created_at", ""),
                        "resolution_time": "",
                        "affected_players": ctx.get("current_count", 0),
                        "description": item.get("analysis", "")[:500],
                        "resolution_status": "investigating",
                        "compensation_given": False,
                        "compensation_amount": 0,
                    }
                )
        if rows:
            key = f"kb/kb_incidents_realtime_{date_str}.csv"
            _write_csv(
                s3,
                data_bucket,
                key,
                rows,
                [
                    "incident_id",
                    "incident_type",
                    "severity",
                    "start_time",
                    "resolution_time",
                    "affected_players",
                    "description",
                    "resolution_status",
                    "compensation_given",
                    "compensation_amount",
                ],
            )
            uploaded_keys.append(key)
            logger.info(f"Wrote {len(rows)} incident rows → {key}")

    # --- 2. Metrics summary → kb_gameplay format ---
    # Matches: gameplay_id, player_id, session_date, game_mode, duration_minutes,
    #          battles_fought, battles_won, experience_gained, credits_earned, energy_consumed,
    #          characters_used, difficulty_level
    if metrics_summary_table_name:
        table = dynamodb.Table(metrics_summary_table_name)
        result = table.scan()
        rows = []
        for item in result.get("Items", []):
            event_type = item.get("event_type", "")
            total = int(item.get("total", 0))
            platforms = item.get("platforms", {})
            regions = item.get("regions", {})
            # One summary row per event_type showing aggregate activity
            rows.append(
                {
                    "gameplay_id": f"summary_{event_type}_{date_str}",
                    "player_id": "aggregate",
                    "session_date": datetime.now(timezone.utc).strftime(
                        "%Y-%m-%d %H:%M:%S"
                    ),
                    "game_mode": event_type,
                    "duration_minutes": 0,
                    "battles_fought": total,
                    "battles_won": 0,
                    "experience_gained": 0,
                    "credits_earned": 0,
                    "energy_consumed": 0,
                    "characters_used": json.dumps(
                        {"platforms": platforms, "regions": regions}
                    ),
                    "difficulty_level": "aggregate",
                }
            )
        if rows:
            key = f"kb/kb_gameplay_realtime_{date_str}.csv"
            _write_csv(
                s3,
                data_bucket,
                key,
                rows,
                [
                    "gameplay_id",
                    "player_id",
                    "session_date",
                    "game_mode",
                    "duration_minutes",
                    "battles_fought",
                    "battles_won",
                    "experience_gained",
                    "credits_earned",
                    "energy_consumed",
                    "characters_used",
                    "difficulty_level",
                ],
            )
            uploaded_keys.append(key)
            logger.info(f"Wrote {len(rows)} gameplay summary rows → {key}")

    # --- 3. Live metrics buckets → kb_session_details format ---
    # Matches: session_id, player_id, session_start_time, session_end_time, session_duration_minutes,
    #          device_model, platform, network_type, activities_completed, battles_fought,
    #          energy_spent, crystals_spent, social_interactions, session_quality_score
    if live_metrics_table_name:
        table = dynamodb.Table(live_metrics_table_name)
        result = table.scan(
            FilterExpression="dimension = :dim AND #ttl > :cutoff",
            ExpressionAttributeNames={"#ttl": "ttl"},
            ExpressionAttributeValues={":dim": "total", ":cutoff": cutoff_ts},
        )
        rows = []
        for item in result.get("Items", []):
            key_parts = item.get("metric_key", "").split("#")
            event_type = key_parts[0] if key_parts else "unknown"
            bucket_ts = int(key_parts[1]) if len(key_parts) > 1 else 0
            bucket_time = (
                datetime.fromtimestamp(bucket_ts, tz=timezone.utc).isoformat()
                if bucket_ts
                else ""
            )
            count = int(item.get("event_count", 0))
            rows.append(
                {
                    "session_id": item.get("metric_key", ""),
                    "player_id": "aggregate",
                    "session_start_time": bucket_time,
                    "session_end_time": "",
                    "session_duration_minutes": 1,
                    "device_model": "aggregate",
                    "platform": event_type,
                    "network_type": "aggregate",
                    "activities_completed": count,
                    "battles_fought": count
                    if "battle" in event_type or "arena" in event_type
                    else 0,
                    "energy_spent": 0,
                    "crystals_spent": 0,
                    "social_interactions": count if "social" in event_type else 0,
                    "session_quality_score": 0,
                }
            )
        if rows:
            key = f"kb/kb_session_details_realtime_{date_str}.csv"
            _write_csv(
                s3,
                data_bucket,
                key,
                rows,
                [
                    "session_id",
                    "player_id",
                    "session_start_time",
                    "session_end_time",
                    "session_duration_minutes",
                    "device_model",
                    "platform",
                    "network_type",
                    "activities_completed",
                    "battles_fought",
                    "energy_spent",
                    "crystals_spent",
                    "social_interactions",
                    "session_quality_score",
                ],
            )
            uploaded_keys.append(key)
            logger.info(f"Wrote {len(rows)} session detail rows → {key}")

    return ", ".join(uploaded_keys) if uploaded_keys else ""


def _write_csv(s3_client, bucket: str, key: str, rows: list, fieldnames: list):
    """Write rows as CSV and upload to S3."""
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    s3_client.put_object(
        Bucket=bucket,
        Key=key,
        Body=buf.getvalue().encode("utf-8"),
        ContentType="text/csv",
    )


def _sync_csvs_to_athena_prefixes(s3_client, bucket: str):
    """Copy all kb/*.csv files to athena/<table_name>/ prefixes for Athena queries."""
    # Map CSV filenames to Athena table names
    table_map = {
        "kb_players.csv": "players",
        "kb_arena_battles.csv": "arena_battles",
        "kb_campaigns.csv": "campaigns",
        "kb_character_interactions.csv": "character_interactions",
        "kb_daily_activities.csv": "daily_activities",
        "kb_event_participation.csv": "event_participation",
        "kb_gameplay.csv": "gameplay",
        "kb_guild_activities.csv": "guild_activities",
        "kb_incidents.csv": "incidents",
        "kb_monetization_events.csv": "monetization_events",
        "kb_purchases.csv": "purchases",
        "kb_session_details.csv": "session_details",
        "kb_social_interactions.csv": "social_interactions",
        "kb_user_acquisition.csv": "user_acquisition",
    }

    paginator = s3_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix="kb/"):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            filename = key.split("/")[-1]
            if not filename.endswith(".csv"):
                continue

            # Determine target table from filename
            table_name = None
            if filename in table_map:
                table_name = table_map[filename]
            else:
                # Handle realtime files like kb_incidents_realtime_2025-01-01.csv
                for base_file, tname in table_map.items():
                    base = base_file.replace(".csv", "")
                    if filename.startswith(base):
                        table_name = tname
                        break

            if table_name:
                dest_key = f"athena/{table_name}/{filename}"
                try:
                    s3_client.copy_object(
                        Bucket=bucket,
                        CopySource={"Bucket": bucket, "Key": key},
                        Key=dest_key,
                    )
                except Exception as e:
                    logger.warning(f"Failed to copy {key} → {dest_key}: {e}")

    logger.info("Synced CSVs to Athena prefixes")


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    1. Export last 24h of DynamoDB data to CSV in the KB S3 bucket.
    2. Start a Bedrock KB ingestion job to rehydrate embeddings.
    """
    try:
        bedrock_agent = boto3.client("bedrock-agent")
        s3vectors = boto3.client("s3vectors")  # noqa: F841

        knowledge_base_id = os.environ.get("KNOWLEDGE_BASE_ID")
        data_source_id = os.environ.get("DATA_SOURCE_ID")
        vector_bucket_name = os.environ.get("VECTOR_BUCKET_NAME")  # noqa: F841
        vector_index_name = os.environ.get("VECTOR_INDEX_NAME")  # noqa: F841
        data_bucket = os.environ.get("DATA_BUCKET_NAME", "")
        reports_table = os.environ.get("REPORTS_TABLE_NAME", "")
        metrics_summary_table = os.environ.get("METRICS_SUMMARY_TABLE_NAME", "")
        live_metrics_table = os.environ.get("LIVE_METRICS_TABLE_NAME", "")

        if not all([knowledge_base_id, data_source_id]):
            raise ValueError(
                "Missing required env vars: KNOWLEDGE_BASE_ID, DATA_SOURCE_ID"
            )

        # Step 1: Export DynamoDB → CSV → S3
        exported_key = ""
        if data_bucket:
            exported_key = export_dynamo_to_csv(
                reports_table, metrics_summary_table, live_metrics_table, data_bucket
            )
        else:
            logger.warning("DATA_BUCKET_NAME not set — skipping DynamoDB export")

        # Step 2: Regenerate summary documents from all KB data
        s3 = boto3.client("s3")
        summary_keys = []
        if data_bucket:
            try:
                summary_keys = generate_summaries(s3, data_bucket)
                logger.info(f"Regenerated {len(summary_keys)} summary documents")
            except Exception as e:
                logger.error(f"Summary generation failed (non-fatal): {e}")

        # Step 2b: Sync CSVs to Athena per-table prefixes
        if data_bucket:
            try:
                _sync_csvs_to_athena_prefixes(s3, data_bucket)
            except Exception as e:
                logger.error(f"Athena sync failed (non-fatal): {e}")

        # Step 3: Start KB ingestion job
        logger.info(f"Starting KB ingestion job for KB: {knowledge_base_id}")
        response = bedrock_agent.start_ingestion_job(
            knowledgeBaseId=knowledge_base_id,
            dataSourceId=data_source_id,
            description=f"Daily rehydration — exported {exported_key or 'no new data'}, {len(summary_keys)} summaries",
        )

        ingestion_job_id = response["ingestionJob"]["ingestionJobId"]
        ingestion_job_status = response["ingestionJob"]["status"]
        logger.info(
            f"Started ingestion job: {ingestion_job_id} ({ingestion_job_status})"
        )

        return {
            "statusCode": 200,
            "body": json.dumps(
                {
                    "message": "KB rehydration started",
                    "exportedKey": exported_key,
                    "ingestionJobId": ingestion_job_id,
                    "ingestionJobStatus": ingestion_job_status,
                    "knowledgeBaseId": knowledge_base_id,
                }
            ),
        }

    except ValueError as e:
        logger.error(f"Config error: {e}")
        return {"statusCode": 400, "body": json.dumps({"error": str(e)})}
    except ClientError as e:
        logger.error(f"AWS error: {e}")
        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return {"statusCode": 500, "body": json.dumps({"error": "Internal error"})}


def get_ingestion_job_status(
    knowledge_base_id: str, data_source_id: str, job_id: str
) -> Optional[Dict[str, Any]]:
    """Utility: get status of an ingestion job."""
    try:
        bedrock_agent = boto3.client("bedrock-agent")
        response = bedrock_agent.get_ingestion_job(
            knowledgeBaseId=knowledge_base_id,
            dataSourceId=data_source_id,
            ingestionJobId=job_id,
        )
        return response["ingestionJob"]
    except ClientError as e:
        logger.error(f"Error getting ingestion job status: {e}")
        return None
