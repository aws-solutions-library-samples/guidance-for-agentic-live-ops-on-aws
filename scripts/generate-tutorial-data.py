# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
Generate synthetic data for a branching game tutorial (FTUE) and its outcomes.

The tutorial has a linear core, a hub where players do three modules (combat,
crafting, social) in any order, two optional modules, and two battles that can
be failed and retried (loops). Players can quit at any step.

Outputs (all synthetic, safe to share):
  data/athena-seed-data/kb_tutorial_steps.csv     -> liveops.tutorial_steps
  data/athena-seed-data/kb_tutorial_events.csv    -> liveops.tutorial_events
  data/athena-seed-data/kb_tutorial_players.csv   -> liveops.tutorial_players
  data/kb-insights/summaries/tutorial_progression_analysis.md  (KB summary)

Planted patterns (the "known answers" for the demo):
  1. craft_item is the biggest drop-off step, mainly on tutorial_version v1.
  2. Players who start with the crafting module complete the tutorial about
     10 points less often than players who start with combat or social.
  3. Skipping the optional crafting module raises completion but lowers D7
     retention among completers by about 40%.
  4. Joining a guild during the tutorial (social module) raises D7 retention.
  5. Failing first_battle 2+ times lowers D1 retention; boss_battle fail loops
     drive quits.
  6. tutorial_version v2 (installs from 2025-09-25, shorter crafting step) cuts
     the craft_item drop-off roughly in half.

Usage (from the repo root):
    python scripts/generate-tutorial-data.py [--players 4000] [--seed 42]
"""

import argparse
import csv
import random
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

SEED_DIR = Path("data/athena-seed-data")
SUMMARY_PATH = Path("data/kb-insights/summaries/tutorial_progression_analysis.md")

START_DATE = datetime(2025, 9, 1, tzinfo=timezone.utc)
END_DATE = datetime(2025, 10, 15, tzinfo=timezone.utc)
V2_LAUNCH = datetime(2025, 9, 25, tzinfo=timezone.utc)

# step_id, step_name, module, nominal_order, is_optional, is_branch_entry, base_seconds, description
STEPS = [
    ("intro_cutscene", "Intro Cutscene", "core", 1, 0, 0, 45, "Opening story cutscene"),
    (
        "movement_basics",
        "Movement Basics",
        "core",
        2,
        0,
        0,
        60,
        "Learn to move and use the camera",
    ),
    (
        "first_battle",
        "First Battle",
        "core",
        3,
        0,
        0,
        90,
        "Scripted first fight that can be failed and retried",
    ),
    (
        "combat_skills",
        "Combat Skills",
        "combat",
        4,
        0,
        1,
        75,
        "Learn hero skills (entry step of the combat module)",
    ),
    (
        "combo_attack",
        "Combo Attack",
        "combat",
        5,
        0,
        0,
        80,
        "Chain skills into a combo",
    ),
    (
        "gather_resources",
        "Gather Resources",
        "crafting",
        6,
        1,
        1,
        110,
        "Collect materials (entry step of the optional crafting module)",
    ),
    (
        "craft_item",
        "Craft Item",
        "crafting",
        7,
        1,
        0,
        240,
        "Craft a first item; long step in v1 and shortened in v2",
    ),
    (
        "join_guild",
        "Join Guild",
        "social",
        8,
        1,
        1,
        50,
        "Join a guild (entry step of the optional social module)",
    ),
    (
        "guild_chat",
        "Guild Chat",
        "social",
        9,
        1,
        0,
        40,
        "Send a first guild chat message",
    ),
    ("equip_gear", "Equip Gear", "core", 10, 0, 0, 55, "Equip gear on the main hero"),
    (
        "first_quest",
        "First Quest",
        "core",
        11,
        0,
        0,
        150,
        "Complete the first story quest",
    ),
    (
        "boss_battle",
        "Boss Battle",
        "core",
        12,
        0,
        0,
        180,
        "Tutorial boss fight that can be failed and retried",
    ),
    (
        "shop_intro",
        "Shop Intro",
        "core",
        13,
        0,
        0,
        45,
        "Guided visit to the in-game shop",
    ),
    (
        "hero_upgrade",
        "Hero Upgrade",
        "core",
        14,
        0,
        0,
        70,
        "Upgrade a hero with earned resources",
    ),
    (
        "daily_rewards",
        "Daily Rewards",
        "core",
        15,
        0,
        0,
        30,
        "Claim the first daily reward",
    ),
    ("tutorial_complete", "Tutorial Complete", "core", 16, 0, 0, 10, "End of tutorial"),
]
STEP_BY_ID = {s[0]: s for s in STEPS}

MODULES = {
    "combat": ["combat_skills", "combo_attack"],
    "crafting": ["gather_resources", "craft_item"],
    "social": ["join_guild", "guild_chat"],
}
CORE_START = ["intro_cutscene", "movement_basics", "first_battle"]
CORE_END = [
    "equip_gear",
    "first_quest",
    "boss_battle",
    "shop_intro",
    "hero_upgrade",
    "daily_rewards",
    "tutorial_complete",
]

# Chance a player quits when they reach a step (before modifiers)
BASE_QUIT = {
    "intro_cutscene": 0.04,
    "movement_basics": 0.03,
    "first_battle": 0.02,
    "combat_skills": 0.015,
    "combo_attack": 0.02,
    "gather_resources": 0.04,
    "craft_item": 0.17,
    "join_guild": 0.02,
    "guild_chat": 0.01,
    "equip_gear": 0.015,
    "first_quest": 0.03,
    "boss_battle": 0.02,
    "shop_intro": 0.02,
    "hero_upgrade": 0.015,
    "daily_rewards": 0.01,
    "tutorial_complete": 0.0,
}
SESSION_BREAK_AFTER = {"gather_resources", "first_quest", "boss_battle"}

COUNTRIES = (
    ["US", "BR", "FR", "DE", "JP", "KR", "MX", "IN", "UK", "ES"],
    [22, 14, 9, 9, 10, 8, 8, 8, 7, 5],
)
CHANNELS = (
    ["organic", "facebook", "google_ads", "tiktok", "unity_ads", "cross_promo"],
    [30, 20, 18, 14, 10, 8],
)


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def iso(ts):
    return ts.strftime("%Y-%m-%dT%H:%M:%SZ")


def simulate_player(rng, idx, event_counter):
    player_id = f"tp_{idx:05d}"
    install_ts = START_DATE + timedelta(
        seconds=rng.randint(0, int((END_DATE - START_DATE).total_seconds()))
    )
    version = "v2" if install_ts >= V2_LAUNCH else "v1"
    platform = rng.choices(["android", "ios"], [55, 45])[0]
    country = rng.choices(*COUNTRIES)[0]
    channel = rng.choices(*CHANNELS)[0]
    skill = rng.random()

    first_module = rng.choices(["combat", "crafting", "social"], [45, 30, 25])[0]
    others = [m for m in MODULES if m != first_module]
    rng.shuffle(others)
    module_seq = [first_module] + others
    skip_crafting = first_module != "crafting" and rng.random() < 0.25
    skip_social = first_module != "social" and rng.random() < 0.35

    plan = list(CORE_START)
    for m in module_seq:
        plan.append(("module", m))
    plan.extend(CORE_END)

    events = []
    ts = install_ts + timedelta(seconds=rng.randint(10, 120))
    session = 1
    seq = 0
    state = {
        "quit_step": None,
        "fb_fails": 0,
        "boss_fails": 0,
        "done": set(),
        "skipped": set(),
    }

    def emit(step_id, event_type, attempt, duration):
        nonlocal seq
        seq += 1
        event_counter[0] += 1
        events.append(
            {
                "event_id": f"te_{event_counter[0]:07d}",
                "player_id": player_id,
                "step_id": step_id,
                "event_type": event_type,
                "event_timestamp": iso(ts),
                "step_seq": seq,
                "attempt_number": attempt,
                "duration_seconds": duration,
                "session_number": session,
                "tutorial_version": version,
            }
        )

    def step_duration(step_id):
        base = STEP_BY_ID[step_id][6]
        if step_id == "craft_item" and version == "v2":
            base = 120
        return max(3, int(base * rng.lognormvariate(0, 0.35)))

    def quit_chance(step_id):
        p = BASE_QUIT[step_id]
        if step_id == "craft_item":
            if version == "v2":
                p = 0.07
            if first_module == "crafting":
                p += 0.08
        return p

    def run_step(step_id):
        """Return True if the player continues, False if they quit."""
        nonlocal ts, session
        if rng.random() < quit_chance(step_id):
            ts += timedelta(seconds=rng.randint(5, 60))
            emit(step_id, "quit", 1, rng.randint(5, 60))
            state["quit_step"] = step_id
            return False

        if step_id in ("first_battle", "boss_battle"):
            if step_id == "first_battle":
                fail_p = clamp(0.30 * (1.3 - skill), 0.03, 0.6)
                quit_per_fail = 0.07
            else:
                fail_p = clamp(
                    0.40 * (1.3 - skill) - (0.08 if first_module == "combat" else 0),
                    0.05,
                    0.7,
                )
                quit_per_fail = 0.09
            attempt = 1
            while attempt <= 4 and rng.random() < fail_p:
                d = step_duration(step_id)
                ts += timedelta(seconds=d)
                emit(step_id, "fail", attempt, d)
                key = "fb_fails" if step_id == "first_battle" else "boss_fails"
                state[key] += 1
                if rng.random() < quit_per_fail * state[key]:
                    ts += timedelta(seconds=rng.randint(5, 30))
                    emit(step_id, "quit", attempt + 1, rng.randint(5, 30))
                    state["quit_step"] = step_id
                    return False
                attempt += 1
            d = step_duration(step_id)
            ts += timedelta(seconds=d)
            emit(step_id, "complete", attempt, d)
        else:
            d = step_duration(step_id)
            ts += timedelta(seconds=d)
            emit(step_id, "complete", 1, d)

        state["done"].add(step_id)
        ts += timedelta(seconds=rng.randint(5, 30))
        if step_id in SESSION_BREAK_AFTER and rng.random() < 0.15:
            ts += timedelta(hours=rng.uniform(2, 20))
            session += 1
        return True

    alive = True
    entered_modules = []
    for item in plan:
        if not alive:
            break
        if isinstance(item, tuple):
            module = item[1]
            if (module == "crafting" and skip_crafting) or (
                module == "social" and skip_social
            ):
                entry = MODULES[module][0]
                ts += timedelta(seconds=rng.randint(2, 8))
                emit(entry, "skip", 1, 0)
                state["skipped"].add(module)
                continue
            entered_modules.append(module)
            for step_id in MODULES[module]:
                if not run_step(step_id):
                    alive = False
                    break
        else:
            if not run_step(item):
                alive = False

    completed = 1 if "tutorial_complete" in state["done"] else 0
    joined_guild = "join_guild" in state["done"]

    # Retention model (planted effects)
    d1_p = 0.58 if completed else 0.22
    if state["fb_fails"] >= 2:
        d1_p -= 0.12
    d1 = 1 if rng.random() < clamp(d1_p, 0.02, 0.95) else 0

    d7_p = 0.30 if completed else 0.05
    if completed and "crafting" in state["skipped"]:
        d7_p *= 0.5
    if joined_guild:
        d7_p += 0.12
    if not d1:
        d7_p *= 0.35
    d7 = 1 if rng.random() < clamp(d7_p, 0.01, 0.95) else 0
    d30 = 1 if rng.random() < (0.45 if d7 else 0.03) else 0

    purchase_p = (
        0.04 + (0.04 if "shop_intro" in state["done"] else 0) + (0.03 if d7 else 0)
    )
    purchased = 1 if rng.random() < purchase_p else 0

    total_seconds = sum(e["duration_seconds"] for e in events)
    player = {
        "player_id": player_id,
        "install_date": install_ts.strftime("%Y-%m-%d"),
        "platform": platform,
        "country": country,
        "acquisition_channel": channel,
        "tutorial_version": version,
        "first_module": entered_modules[0] if entered_modules else "",
        "module_order": ">".join(entered_modules),
        "skipped_crafting": 1 if "crafting" in state["skipped"] else 0,
        "skipped_social": 1 if "social" in state["skipped"] else 0,
        "first_battle_fails": state["fb_fails"],
        "boss_battle_fails": state["boss_fails"],
        "completed_tutorial": completed,
        "last_step_id": "tutorial_complete" if completed else state["quit_step"],
        "steps_completed": len(state["done"]),
        "total_tutorial_minutes": round(total_seconds / 60, 1),
        "retention_d1": d1,
        "retention_d7": d7,
        "retention_d30": d30,
        "purchased_within_d7": purchased,
    }
    return player, events


def write_csv(path, rows, fields):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def pct(n, d):
    return f"{(100.0 * n / d):.1f}%" if d else "n/a"


def build_summary(players, events):
    total = len(players)
    completed = [p for p in players if p["completed_tutorial"] == 1]
    reached = defaultdict(set)
    for e in events:
        reached[e["step_id"]].add(e["player_id"])
    quits = Counter(e["step_id"] for e in events if e["event_type"] == "quit")

    lines = [
        "# Tutorial Progression Analysis",
        "",
        "Synthetic first-time user experience (FTUE) tutorial data for a cohort of new installs "
        f"from {START_DATE:%Y-%m-%d} to {END_DATE:%Y-%m-%d}. Tables: liveops.tutorial_steps, "
        "liveops.tutorial_events, liveops.tutorial_players.",
        "",
        "## Overall",
        f"- Players who started the tutorial: {total}",
        f"- Completed the tutorial: {len(completed)} ({pct(len(completed), total)})",
        f"- D1 retention: {pct(sum(p['retention_d1'] for p in players), total)}",
        f"- D7 retention: {pct(sum(p['retention_d7'] for p in players), total)}",
        "",
        "## Funnel (players reaching each step, and quits at that step)",
    ]
    for s in STEPS:
        sid = s[0]
        r = len(reached[sid])
        lines.append(
            f"- {s[3]:02d} {sid} ({s[2]}): reached {r}, quit here {quits[sid]} ({pct(quits[sid], r)} of those who reached it)"
        )

    lines += ["", "## Top drop-off steps"]
    for sid, q in quits.most_common(5):
        lines.append(f"- {sid}: {q} quits ({pct(q, total)} of all players)")

    lines += ["", "## Completion by first module chosen"]
    for m in ["combat", "crafting", "social"]:
        grp = [p for p in players if p["first_module"] == m]
        lines.append(
            f"- {m} first: {len(grp)} players, completion {pct(sum(p['completed_tutorial'] for p in grp), len(grp))}"
        )

    def d7_rate(grp):
        return pct(sum(p["retention_d7"] for p in grp), len(grp))

    did_craft = [p for p in completed if p["skipped_crafting"] == 0]
    skip_craft = [p for p in completed if p["skipped_crafting"] == 1]
    # Completers either joined a guild (social module done) or skipped social
    guild = [p for p in completed if p["skipped_social"] == 0]
    no_guild = [p for p in completed if p["skipped_social"] == 1]
    lines += [
        "",
        "## Optional modules and D7 retention (completers only)",
        f"- Did crafting: {len(did_craft)} players, D7 {d7_rate(did_craft)}",
        f"- Skipped crafting: {len(skip_craft)} players, D7 {d7_rate(skip_craft)}",
        f"- Joined a guild in the tutorial: {len(guild)} players, D7 {d7_rate(guild)}",
        f"- Did not join a guild: {len(no_guild)} players, D7 {d7_rate(no_guild)}",
    ]

    lines += ["", "## Battle retry loops"]
    for label, fails in [("0 first_battle fails", 0), ("1 first_battle fail", 1)]:
        grp = [p for p in players if p["first_battle_fails"] == fails]
        lines.append(
            f"- {label}: {len(grp)} players, D1 {pct(sum(p['retention_d1'] for p in grp), len(grp))}"
        )
    grp = [p for p in players if p["first_battle_fails"] >= 2]
    lines.append(
        f"- 2+ first_battle fails: {len(grp)} players, D1 {pct(sum(p['retention_d1'] for p in grp), len(grp))}"
    )
    boss_quits = sum(1 for p in players if p["last_step_id"] == "boss_battle")
    lines.append(f"- Players who quit at boss_battle: {boss_quits}")

    lines += [
        "",
        "## Tutorial version (v2 launched 2025-09-25 with a shorter craft_item step)",
    ]
    for v in ["v1", "v2"]:
        grp = [p for p in players if p["tutorial_version"] == v]
        ids = {p["player_id"] for p in grp}
        r = len(reached["craft_item"] & ids)
        q = sum(1 for p in grp if p["last_step_id"] == "craft_item")
        lines.append(
            f"- {v}: {len(grp)} players, completion {pct(sum(p['completed_tutorial'] for p in grp), len(grp))}, craft_item quit rate {pct(q, r)}"
        )

    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(
        description="Generate synthetic tutorial progression data"
    )
    parser.add_argument("--players", type=int, default=4000)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    event_counter = [0]
    players, events = [], []
    for i in range(1, args.players + 1):
        p, evs = simulate_player(rng, i, event_counter)
        players.append(p)
        events.extend(evs)

    step_rows = [
        {
            "step_id": s[0],
            "step_name": s[1],
            "module": s[2],
            "nominal_order": s[3],
            "is_optional": s[4],
            "is_branch_entry": s[5],
            "description": s[7],
        }
        for s in STEPS
    ]
    write_csv(SEED_DIR / "kb_tutorial_steps.csv", step_rows, list(step_rows[0].keys()))
    write_csv(SEED_DIR / "kb_tutorial_events.csv", events, list(events[0].keys()))
    write_csv(SEED_DIR / "kb_tutorial_players.csv", players, list(players[0].keys()))

    summary = build_summary(players, events)
    SUMMARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    SUMMARY_PATH.write_text(summary, encoding="utf-8")

    print(f"Players: {len(players)}  Events: {len(events)}")
    print(f"Wrote {SEED_DIR}/kb_tutorial_*.csv and {SUMMARY_PATH}\n")
    print(summary)


if __name__ == "__main__":
    main()
