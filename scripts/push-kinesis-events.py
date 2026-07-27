# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
Push synthetic game events to the Kinesis stream for testing the realtime monitor pipeline.

Usage:
    python scripts/push-kinesis-events.py --stream-name <STREAM_NAME> [--profile <AWS_PROFILE>] [--region us-west-2] [--count 200] [--scenario spike]

Scenarios:
    normal    — steady mix of events at low volume (default)
    spike     — burst of battle_error + session_drop events to trigger pattern rules
    purchase  — elevated purchase_failure events
    churn     — high churn_signal volume
    random    — randomly picks one metric and spikes it above its threshold
    baseline  — bell-curve traffic for each monitored metric around --baseline value, with natural variance
"""

import argparse
import json
import math
import random
import time
import uuid
from datetime import datetime, timezone

import boto3

EVENT_TYPES = [
    # Monitored (pattern detection rules exist)
    "battle_error",
    "session_drop",
    "purchase_failure",
    "churn_signal",
    "api_abuse",  # external hammering / hacking attempt
    # General gameplay
    "session_end",
    "purchase",
    "login",
    "logout",
    "level_complete",
    "arena_match",
    # KB-aligned new event types
    "character_upgrade",  # kb_character_interactions
    "daily_activity",  # kb_daily_activities
    "event_participation",  # kb_event_participation
    "gameplay_session",  # kb_gameplay
    "guild_activity",  # kb_guild_activities
    "monetization_event",  # kb_monetization_events
    "social_interaction",  # kb_social_interactions
]

PLATFORMS = ["android", "ios"]
REGIONS = ["US", "KR", "JP", "EU", "BR"]
FACTIONS = ["Light", "Dark"]
CLASSES = ["Support", "Damage", "Tank"]

# KB-aligned reference data
PLAYER_SEGMENTS = ["whale", "dolphin", "f2p_hardcore", "f2p_casual", "new_player"]
GUILDS = [
    "guild_silver_phoenixes",
    "guild_crimson_legion",
    "guild_iron_vanguard",
    "guild_shadow_wolves",
    "guild_golden_dragons",
    "guild_storm_riders",
    "guild_sapphire_guardians",
]
CHARACTERS = [
    "Aria the Swift",
    "Blaze Ironforge",
    "Celeste Moonwhisper",
    "Drak the Destroyer",
    "Elara Sunblade",
    "Fenrir Shadowpaw",
    "Zephyr Nightshade",
    "Kael Shadowborn",
    "Lyra Dawnseeker",
]
ITEMS = [
    "gem_pack_small",
    "gem_pack_large",
    "battle_pass",
    "skin_bundle",
    "hero_shard",
    "energy_refill",
    "gear_bundle",
]
PAYMENT_METHODS = ["google_play", "apple_pay", "credit_card", "digital_wallet"]
CAMPAIGNS = ["CAMP_001", "CAMP_002", "CAMP_003", "CAMP_004", "CAMP_005"]
DEVICE_MODELS = [
    "Samsung Galaxy S24",
    "iPhone 15 Pro",
    "Pixel 8",
    "OnePlus 12",
    "iPhone 14",
]
NETWORK_TYPES = ["wifi", "4g", "5g", "3g"]
ERROR_CODES = ["SYNC_FAIL", "TIMEOUT", "DESYNC", "CRASH", "AUTH_FAIL", "NETWORK_ERR"]
GAME_MODES = [
    "fleet_battles",
    "arena_battles",
    "territory_battles",
    "squad_battles",
    "pve_campaign",
]
INTERACTION_TYPES_CHAR = [
    "relic_upgrade",
    "mod_upgrade",
    "gear_upgrade",
    "star_upgrade",
    "ability_upgrade",
]
INTERACTION_TYPES_SOCIAL = [
    "guild_chat",
    "guild_invite",
    "direct_message",
    "trade_request",
    "friend_request",
]
ACTIVITY_TYPES = [
    "daily_mission_complete",
    "daily_login",
    "weekly_challenge",
    "guild_raid",
    "pvp_battle",
]
EVENT_NAMES = [
    "Raid: Shadow Citadel",
    "Territory War",
    "Grand Arena",
    "Fleet Arena Championship",
    "Guild Conquest",
]
RAID_TIERS = ["normal", "challenge", "heroic"]
DIFFICULTY_LEVELS = ["easy", "normal", "hard", "legendary"]


def make_event(event_type: str) -> dict:
    """Generate a single game event with KB-aligned rich details."""
    player_id = f"player_{random.randint(1, 10000):05d}"
    ts = datetime.now(timezone.utc).isoformat()
    platform = random.choice(PLATFORMS)
    region = random.choice(REGIONS)
    segment = random.choice(PLAYER_SEGMENTS)
    player_level = random.randint(1, 85)
    guild_id = random.choice(GUILDS) if random.random() > 0.2 else None

    details: dict = {
        "session_id": str(uuid.uuid4())[:8],
        "player_segment": segment,
        "player_level": player_level,
        "guild_id": guild_id,
        "device_model": random.choice(DEVICE_MODELS),
        "network_type": random.choice(NETWORK_TYPES),
    }

    if event_type == "battle_error":
        details["error_code"] = random.choice(ERROR_CODES)
        details["arena_tier"] = random.randint(1, 10)
        details["character_used"] = random.choice(CHARACTERS)
        details["opponent_level"] = random.randint(1, 85)
        details["battle_duration_seconds"] = random.randint(5, 300)

    elif event_type in ("session_end", "session_drop"):
        duration = random.randint(10, 3600)
        details["duration_seconds"] = duration
        details["duration_minutes"] = round(duration / 60, 1)
        details["activities_completed"] = random.randint(0, 30)
        details["battles_fought"] = random.randint(0, 20)
        details["energy_spent"] = random.randint(0, 300)
        details["crystals_spent"] = random.randint(0, 500)
        details["social_interactions"] = random.randint(0, 15)
        details["session_quality_score"] = round(random.uniform(1.0, 10.0), 1)
        if event_type == "session_drop":
            details["drop_reason"] = random.choice(
                ["network_loss", "app_crash", "server_kick", "timeout"]
            )

    elif event_type == "purchase":
        item = random.choice(ITEMS)
        amount = round(random.uniform(0.99, 99.99), 2)
        details["item"] = item
        details["amount_usd"] = amount
        details["payment_method"] = random.choice(PAYMENT_METHODS)
        details["campaign_id"] = (
            random.choice(CAMPAIGNS) if random.random() > 0.5 else None
        )
        details["lifetime_spend_usd"] = round(random.uniform(0, 1000), 2)
        details["is_first_purchase"] = random.random() < 0.1

    elif event_type == "purchase_failure":
        details["item"] = random.choice(ITEMS)
        details["amount_usd"] = round(random.uniform(0.99, 99.99), 2)
        details["payment_method"] = random.choice(PAYMENT_METHODS)
        details["failure_reason"] = random.choice(
            [
                "insufficient_funds",
                "payment_declined",
                "network_timeout",
                "invalid_card",
                "fraud_detected",
                "store_error",
            ]
        )
        details["retry_count"] = random.randint(0, 3)

    elif event_type == "churn_signal":
        details["days_inactive"] = random.randint(3, 30)
        details["lifetime_spend_usd"] = round(random.uniform(0, 500), 2)
        details["last_activity"] = random.choice(
            ["battle", "purchase", "login", "guild_activity"]
        )
        details["churn_risk_score"] = round(random.uniform(0.5, 1.0), 2)
        details["campaign_eligible"] = random.random() > 0.4

    elif event_type == "arena_match":
        rank_before = random.randint(1, 20000)
        rank_change = random.randint(-50, 50)
        details["faction"] = random.choice(FACTIONS)
        details["character_class"] = random.choice(CLASSES)
        details["characters_used"] = "|".join(
            random.sample(CHARACTERS, k=min(3, len(CHARACTERS)))
        )
        details["battle_type"] = random.choice(
            ["squad_arena", "fleet_arena", "grand_arena"]
        )
        details["result"] = random.choice(["victory", "defeat"])
        details["player_rank_before"] = rank_before
        details["player_rank_after"] = rank_before + rank_change
        details["team_power_used"] = random.randint(50000, 5000000)
        details["opponent_team_power"] = random.randint(50000, 5000000)
        details["battle_duration_seconds"] = random.randint(30, 300)
        details["crystals_earned"] = random.randint(0, 50)
        details["arena_tokens_earned"] = random.randint(0, 100)
        details["strategy_effectiveness"] = round(random.uniform(1.0, 5.0), 1)

    elif event_type == "level_complete":
        details["level_reached"] = player_level
        details["time_to_complete_hours"] = round(random.uniform(0.5, 48.0), 1)
        details["character_used"] = random.choice(CHARACTERS)
        details["stars_earned"] = random.randint(1, 3)
        details["energy_spent"] = random.randint(10, 100)

    elif event_type in ("login", "logout"):
        details["consecutive_days"] = random.randint(1, 365)
        details["daily_reward_claimed"] = random.random() > 0.3
        if event_type == "login":
            details["campaign_notification_shown"] = (
                random.choice(CAMPAIGNS) if random.random() > 0.6 else None
            )

    # --- New KB-aligned event types ---

    elif event_type == "character_upgrade":
        # kb_character_interactions
        char = random.choice(CHARACTERS)
        level_before = random.randint(1, 84)
        details["character_name"] = char
        details["interaction_type"] = random.choice(INTERACTION_TYPES_CHAR)
        details["level_before"] = level_before
        details["level_after"] = level_before + random.randint(1, 5)
        details["power_before"] = random.randint(5000, 20000000)
        details["power_after"] = details["power_before"] + random.randint(100, 500000)
        details["star_level_before"] = random.randint(1, 7)
        details["star_level_after"] = min(
            details["star_level_before"] + random.randint(0, 1), 7
        )
        details["relic_level_before"] = random.randint(0, 9)
        details["relic_level_after"] = min(
            details["relic_level_before"] + random.randint(0, 1), 9
        )
        details["gear_pieces_applied"] = random.randint(0, 12)
        details["credits_spent"] = random.randint(0, 1000000)
        details["materials_used"] = random.randint(0, 200)

    elif event_type == "daily_activity":
        # kb_daily_activities
        details["activity_type"] = random.choice(ACTIVITY_TYPES)
        details["activity_count"] = random.randint(1, 10)
        details["points_earned"] = random.randint(50, 1000)
        details["time_spent_minutes"] = random.randint(5, 120)
        details["completion_status"] = random.choice(["completed", "partial", "failed"])
        details["reward_claimed"] = random.random() > 0.3

    elif event_type == "event_participation":
        # kb_event_participation
        details["event_name"] = random.choice(EVENT_NAMES)
        details["event_type_sub"] = random.choice(["pve", "pvp", "guild", "fleet"])
        details["participation_level"] = random.choice(
            ["bronze", "silver", "gold", "platinum"]
        )
        details["score_achieved"] = random.randint(100, 10000)
        details["rank_achieved"] = random.randint(1, 1000)
        details["rewards_earned"] = random.randint(0, 5000)
        details["completion_percentage"] = round(random.uniform(0.0, 1.0), 2)

    elif event_type == "gameplay_session":
        # kb_gameplay
        duration = random.randint(5, 300)
        battles = random.randint(1, 20)
        details["game_mode"] = random.choice(GAME_MODES)
        details["duration_minutes"] = duration
        details["battles_fought"] = battles
        details["battles_won"] = random.randint(0, battles)
        details["experience_gained"] = random.randint(100, 10000)
        details["credits_earned"] = random.randint(1000, 100000)
        details["energy_consumed"] = random.randint(5, 100)
        details["characters_used"] = random.randint(1, 5)
        details["difficulty_level"] = random.choice(DIFFICULTY_LEVELS)

    elif event_type == "guild_activity":
        # kb_guild_activities
        details["activity_type"] = random.choice(
            ["raid_participation", "territory_battle", "territory_war", "guild_event"]
        )
        details["contribution_score"] = random.randint(0, 5000)
        details["damage_dealt"] = random.randint(0, 10000000)
        details["energy_donated"] = random.randint(0, 500)
        details["guild_tokens_earned"] = random.randint(0, 200)
        details["participation_rank"] = random.randint(1, 50)
        details["raid_tier"] = random.choice(RAID_TIERS)
        details["territory_battles_participated"] = random.randint(0, 5)
        details["territory_war_battles"] = random.randint(0, 10)

    elif event_type == "monetization_event":
        # kb_monetization_events
        amount = round(random.uniform(0.99, 99.99), 2)
        details["purchase_type"] = random.choice(
            ["one_time", "subscription", "consideration"]
        )
        details["item_considered"] = random.choice(ITEMS)
        details["amount_usd"] = amount
        details["purchase_decision"] = random.choice(
            ["purchased", "declined", "abandoned"]
        )
        details["payment_method"] = (
            random.choice(PAYMENT_METHODS) if random.random() > 0.3 else None
        )
        details["first_time_purchase"] = random.random() < 0.1
        details["days_since_install"] = random.randint(0, 1000)
        details["segment_classification"] = segment

    elif event_type == "social_interaction":
        # kb_social_interactions
        details["target_player_id"] = f"player_{random.randint(1, 10000):05d}"
        details["interaction_type"] = random.choice(INTERACTION_TYPES_SOCIAL)
        details["message_length"] = random.randint(0, 500)
        details["sentiment"] = random.choice(["positive", "neutral", "negative"])
        details["response_received"] = random.random() > 0.4
        details["guild_context"] = guild_id is not None
        details["influence_score"] = round(random.uniform(0.0, 1.0), 2)

    elif event_type == "api_abuse":
        # External hammering / hacking attempt — no valid player context
        details["source_ip"] = (
            f"{random.randint(1, 255)}.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(0, 255)}"
        )
        details["target_endpoint"] = random.choice(
            [
                "/api/login",
                "/api/purchase",
                "/api/player/profile",
                "/api/leaderboard",
                "/api/auth/token",
                "/api/admin",
            ]
        )
        details["request_count"] = random.randint(50, 2000)
        details["time_window_seconds"] = random.randint(5, 60)
        details["requests_per_second"] = round(
            details["request_count"] / details["time_window_seconds"], 1
        )
        details["http_method"] = random.choice(["POST", "GET", "PUT", "DELETE"])
        details["response_codes"] = random.choice(["429", "401", "403", "200"])
        details["user_agent"] = random.choice(
            [
                "python-requests/2.31",
                "curl/7.88",
                "Go-http-client/1.1",
                "Mozilla/5.0 (bot)",
                "sqlmap/1.7",
                "nikto/2.1",
            ]
        )
        details["attack_type"] = random.choice(
            [
                "brute_force",
                "credential_stuffing",
                "rate_limit_bypass",
                "sql_injection_probe",
                "ddos",
                "scraping",
            ]
        )
        details["waf_blocked"] = random.random() > 0.3
        details["geo_country"] = random.choice(
            ["CN", "RU", "KP", "IR", "US", "BR", "unknown"]
        )

    return {
        "event_type": event_type,
        "player_id": player_id,
        "timestamp": ts,
        "platform": platform,
        "region": region,
        "details": details,
    }


def build_scenario_events(scenario: str, count: int) -> list:
    """Build a list of events based on the chosen scenario."""
    events = []

    # Metrics that have pattern detection rules with their thresholds
    SPIKE_TARGETS = {
        "battle_error": 50,
        "session_drop": 100,
        "purchase_failure": 20,
        "churn_signal": 30,
        "api_abuse": 25,
    }

    if scenario == "random":
        # Randomly pick one metric and spike it above its threshold
        target = random.choice(list(SPIKE_TARGETS.keys()))
        threshold = SPIKE_TARGETS[target]
        # Generate 1.5x-2.5x the threshold to ensure it triggers
        spike_count = random.randint(int(threshold * 1.5), int(threshold * 2.5))
        spike_count = min(spike_count, count)

        print(
            f"   🎲 Random spike target: {target} ({spike_count} events, threshold: {threshold})"
        )

        for _ in range(spike_count):
            events.append(make_event(target))

        # Give each other monitored metric a distinct low baseline so lines separate
        remaining = count - len(events)
        other_targets = [t for t in SPIKE_TARGETS if t != target]
        baselines = {}
        for i, t in enumerate(other_targets):
            # Stagger baselines: ~5%, ~15%, ~25% of threshold
            base = max(1, int(SPIKE_TARGETS[t] * (0.05 + 0.1 * i)))
            baselines[t] = min(base, remaining // (len(other_targets) + 2))

        for t, base_count in baselines.items():
            for _ in range(base_count):
                events.append(make_event(t))
                remaining -= 1

        # Fill the rest with non-monitored background noise
        background_types = [t for t in EVENT_TYPES if t not in SPIKE_TARGETS]
        for _ in range(remaining):
            events.append(make_event(random.choice(background_types)))

    elif scenario == "spike":
        # Heavy battle_error + session_drop to trigger default rules (threshold 50 / 100)
        for _ in range(int(count * 0.4)):
            events.append(make_event("battle_error"))
        for _ in range(int(count * 0.4)):
            events.append(make_event("session_drop"))
        for _ in range(count - len(events)):
            events.append(make_event(random.choice(EVENT_TYPES)))

    elif scenario == "purchase":
        for _ in range(int(count * 0.5)):
            events.append(make_event("purchase_failure"))
        for _ in range(count - len(events)):
            events.append(make_event(random.choice(EVENT_TYPES)))

    elif scenario == "churn":
        for _ in range(int(count * 0.5)):
            events.append(make_event("churn_signal"))
        for _ in range(count - len(events)):
            events.append(make_event(random.choice(EVENT_TYPES)))

    else:  # normal
        for _ in range(count):
            events.append(make_event(random.choice(EVENT_TYPES)))
        # ~5% chance of a random api_abuse burst (10-40 events) mixed in
        if random.random() < 0.05:
            burst = random.randint(10, 40)
            for _ in range(burst):
                events.append(make_event("api_abuse"))
            print(f"   ⚠️  Injected api_abuse burst: {burst} events")

    random.shuffle(events)
    return events


def build_baseline_batch(baseline: int, iteration: int, total_iterations: int) -> list:
    """Build a batch with bell-curve traffic. Each metric gets a different curve shape."""
    events = []

    # Bell curve: peak in the middle of the run, taper at edges
    # Use a gaussian centered at total_iterations/2
    if total_iterations > 1:
        center = total_iterations / 2
        sigma = total_iterations / 4
        curve_factor = math.exp(-0.5 * ((iteration - center) / max(sigma, 1)) ** 2)
    else:
        curve_factor = 1.0

    # Each metric gets a different multiplier for variety
    metric_profiles = {
        "battle_error": {"base_mult": 0.3, "noise": 0.4},
        "session_drop": {"base_mult": 0.5, "noise": 0.3},
        "purchase_failure": {"base_mult": 0.15, "noise": 0.5},
        "churn_signal": {"base_mult": 0.2, "noise": 0.35},
    }

    for event_type, profile in metric_profiles.items():
        # Base count scaled by bell curve + random noise
        base = baseline * profile["base_mult"]
        curved = base * (0.3 + 0.7 * curve_factor)  # min 30% of base even at edges
        noise = random.gauss(0, curved * profile["noise"])
        count = max(0, int(curved + noise))

        for _ in range(count):
            events.append(make_event(event_type))

    # Add some background noise (non-monitored events)
    background_types = [t for t in EVENT_TYPES if t not in metric_profiles]
    bg_count = max(5, int(baseline * 0.1 * curve_factor))
    for _ in range(bg_count):
        events.append(make_event(random.choice(background_types)))

    random.shuffle(events)
    return events


def put_records(kinesis_client, stream_name: str, events: list):
    """Send events to Kinesis in batches of 500 (API limit)."""
    batch_size = 500
    total_sent = 0

    for i in range(0, len(events), batch_size):
        batch = events[i : i + batch_size]
        records = [
            {
                "Data": json.dumps(evt).encode("utf-8"),
                "PartitionKey": evt["player_id"],
            }
            for evt in batch
        ]

        resp = kinesis_client.put_records(StreamName=stream_name, Records=records)
        failed = resp.get("FailedRecordCount", 0)
        total_sent += len(records) - failed

        if failed:
            print(f"  ⚠ {failed} records failed in batch {i // batch_size + 1}")

    return total_sent


def main():
    parser = argparse.ArgumentParser(
        description="Push game events to Kinesis for testing"
    )
    parser.add_argument("--stream-name", required=True, help="Kinesis stream name")
    parser.add_argument(
        "--profile",
        help="AWS CLI profile (optional, defaults to environment credentials)",
    )
    parser.add_argument(
        "--region", default="us-west-2", help="AWS region (default: us-west-2)"
    )
    parser.add_argument(
        "--count", type=int, default=200, help="Number of events to send (default: 200)"
    )
    parser.add_argument(
        "--scenario",
        choices=["normal", "spike", "purchase", "churn", "random", "baseline"],
        default="normal",
        help="Event scenario (default: normal). 'random' picks a random metric to spike. 'baseline' generates bell-curve traffic.",
    )
    parser.add_argument(
        "--baseline",
        type=int,
        default=100,
        help="Base event count per iteration for 'baseline' scenario (default: 100). Each metric gets a fraction of this.",
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=20,
        help="Number of iterations for 'baseline' scenario bell curve (default: 20). More = smoother curve.",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=0,
        help="Repeat every N seconds (0 = run once). Each iteration picks a new random target if using 'random' scenario.",
    )
    args = parser.parse_args()

    session = (
        boto3.Session(profile_name=args.profile, region_name=args.region)
        if args.profile
        else boto3.Session(region_name=args.region)
    )
    kinesis = session.client("kinesis")

    iteration = 0
    try:
        if args.scenario == "baseline":
            # Bell curve mode: run for --iterations with --interval spacing
            interval = args.interval if args.interval > 0 else 5
            total = args.iterations
            infinite = total <= 0
            if infinite:
                total = 20  # bell curve cycle length
            print(
                f"🔔 Baseline bell-curve mode: {'infinite' if infinite else total} iterations, {interval}s apart, base={args.baseline}"
            )
            i = 0
            while True:
                cycle_pos = i % total
                iteration = i + 1
                events = build_baseline_batch(args.baseline, cycle_pos, total)

                from collections import Counter

                type_counts = Counter(e["event_type"] for e in events)
                print(
                    f"\n[#{iteration}/{total}] 🎮 {len(events)} events (curve pos: {i}/{total})"
                )
                for et, c in type_counts.most_common():
                    print(f"   {et}: {c}")

                print("  📡 Pushing to stream...")
                start = time.time()
                sent = put_records(kinesis, args.stream_name, events)
                elapsed = time.time() - start
                print(f"  ✅ Sent {sent}/{len(events)} in {elapsed:.1f}s")

                if not infinite and cycle_pos >= total - 1:
                    break
                time.sleep(interval)
                i += 1

            print(f"\n🏁 Baseline complete: {i + 1} iterations")
        else:
            while True:
                iteration += 1
                prefix = f"[#{iteration}] " if args.interval > 0 else ""

                print(
                    f"\n{prefix}🎮 Generating {args.count} events — scenario: {args.scenario}"
                )
                events = build_scenario_events(args.scenario, args.count)

                from collections import Counter

                type_counts = Counter(e["event_type"] for e in events)
                for et, c in type_counts.most_common():
                    print(f"   {et}: {c}")

                print(f"\n{prefix}📡 Pushing to stream: {args.stream_name}")
                start = time.time()
                sent = put_records(kinesis, args.stream_name, events)
                elapsed = time.time() - start

                print(f"{prefix}✅ Sent {sent}/{len(events)} events in {elapsed:.1f}s")

                if args.interval <= 0:
                    break

                print(f"\n⏳ Next batch in {args.interval}s (Ctrl+C to stop)")
                time.sleep(args.interval)

    except KeyboardInterrupt:
        print(f"\n🛑 Stopped after {iteration} iteration(s)")


if __name__ == "__main__":
    main()
