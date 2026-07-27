# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
Demo Heartbeat Lambda — pushes synthetic game events to Kinesis on a schedule.

Active scenario is read from SSM Parameter Store on each invocation so it can be
changed from the Monitor dashboard without redeployment.

Scenarios:
  baseline  — steady bell-curve traffic with occasional random spikes (default)
  spike     — burst of battle_error + session_drop to trigger pattern rules
  purchase  — elevated purchase_failure events
  churn     — high churn_signal volume
  random    — randomly picks one monitored metric and spikes it above threshold
"""

import json
import math
import os
import random
import uuid
from datetime import datetime, timezone

import boto3

STREAM_NAME = os.environ["STREAM_NAME"]
SCENARIO_PARAM = os.environ.get("SCENARIO_PARAM", "")
SCENARIO_DEFAULT = os.environ.get("SCENARIO_DEFAULT", "baseline")
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "150"))
SPIKE_PROBABILITY = float(os.environ.get("SPIKE_PROBABILITY", "0.15"))

kinesis = boto3.client("kinesis")
ssm = boto3.client("ssm")

EVENT_TYPES = [
    "battle_error",
    "session_drop",
    "purchase_failure",
    "churn_signal",
    "api_abuse",
    "login",
    "logout",
    "session_end",
    "purchase",
    "level_complete",
    "arena_match",
    "character_upgrade",
    "daily_activity",
    "event_participation",
    "gameplay_session",
    "guild_activity",
    "monetization_event",
    "social_interaction",
]

MONITORED = {
    "battle_error": 50,
    "session_drop": 100,
    "purchase_failure": 20,
    "churn_signal": 30,
    "api_abuse": 25,
}

PLATFORMS = ["android", "ios"]
REGIONS = ["US", "KR", "JP", "EU", "BR"]

_iteration = 0


def get_scenario() -> str:
    """Read active scenario from SSM, fall back to env var default."""
    if not SCENARIO_PARAM:
        return SCENARIO_DEFAULT
    try:
        resp = ssm.get_parameter(Name=SCENARIO_PARAM)
        return resp["Parameter"]["Value"]
    except Exception:
        return SCENARIO_DEFAULT


def make_event(event_type: str) -> dict:
    return {
        "event_type": event_type,
        "player_id": f"player_{random.randint(1, 10000):05d}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "platform": random.choice(PLATFORMS),
        "region": random.choice(REGIONS),
        "details": {
            "session_id": str(uuid.uuid4())[:8],
            "player_level": random.randint(1, 85),
        },
    }


def build_events(scenario: str, count: int, iteration: int) -> list:
    events = []
    background = [t for t in EVENT_TYPES if t not in MONITORED]

    if scenario == "spike":
        for _ in range(int(count * 0.4)):
            events.append(make_event("battle_error"))
        for _ in range(int(count * 0.4)):
            events.append(make_event("session_drop"))
        for _ in range(count - len(events)):
            events.append(make_event(random.choice(EVENT_TYPES)))

    elif scenario == "purchase":
        for _ in range(int(count * 0.6)):
            events.append(make_event("purchase_failure"))
        for _ in range(count - len(events)):
            events.append(make_event(random.choice(EVENT_TYPES)))

    elif scenario == "churn":
        for _ in range(int(count * 0.6)):
            events.append(make_event("churn_signal"))
        for _ in range(count - len(events)):
            events.append(make_event(random.choice(EVENT_TYPES)))

    elif scenario == "random":
        target = random.choice(list(MONITORED.keys()))
        threshold = MONITORED[target]
        spike_count = min(
            random.randint(int(threshold * 1.5), int(threshold * 2.5)), count
        )
        for _ in range(spike_count):
            events.append(make_event(target))
        for _ in range(count - len(events)):
            events.append(make_event(random.choice(background)))

    else:  # baseline
        total = 20
        cycle_pos = iteration % total
        center = total / 2
        sigma = total / 4
        curve = math.exp(-0.5 * ((cycle_pos - center) / max(sigma, 1)) ** 2)

        profiles = {
            "battle_error": 0.3,
            "session_drop": 0.5,
            "purchase_failure": 0.15,
            "churn_signal": 0.2,
        }
        for event_type, mult in profiles.items():
            base = count * mult
            curved = base * (0.3 + 0.7 * curve)
            n = max(0, int(curved + random.gauss(0, curved * 0.3)))
            for _ in range(n):
                events.append(make_event(event_type))

        bg = max(5, int(count * 0.1 * curve))
        for _ in range(bg):
            events.append(make_event(random.choice(background)))

        if random.random() < SPIKE_PROBABILITY:
            target = random.choice(list(MONITORED.keys()))
            threshold = MONITORED[target]
            spike = random.randint(int(threshold * 1.2), int(threshold * 2.0))
            for _ in range(spike):
                events.append(make_event(target))

    random.shuffle(events)
    return events


def put_records(events: list) -> int:
    sent = 0
    for i in range(0, len(events), 500):
        batch = events[i : i + 500]
        records = [
            {"Data": json.dumps(e).encode(), "PartitionKey": e["player_id"]}
            for e in batch
        ]
        resp = kinesis.put_records(StreamName=STREAM_NAME, Records=records)
        sent += len(records) - resp.get("FailedRecordCount", 0)
    return sent


def handler(event, context):
    global _iteration
    _iteration += 1

    scenario = get_scenario()
    events = build_events(scenario, BATCH_SIZE, _iteration)
    sent = put_records(events)

    print(
        json.dumps(
            {
                "scenario": scenario,
                "iteration": _iteration,
                "generated": len(events),
                "sent": sent,
            }
        )
    )

    return {"sent": sent, "scenario": scenario, "iteration": _iteration}
