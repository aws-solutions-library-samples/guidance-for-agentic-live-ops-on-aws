#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""
Generate KB summary markdown documents from CSV data.
Matches the format used by the kb-sync-s3vectors Lambda so that
deploy-time summaries and runtime-generated summaries are consistent.
"""

import csv
from collections import Counter, defaultdict
from pathlib import Path

DATA_DIR = Path("data/athena-seed-data")
OUTPUT_DIR = Path("data/kb-insights/summaries")
OUTPUT_DIR.mkdir(exist_ok=True)


def load_csv(filename):
    rows = []
    with open(DATA_DIR / filename, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rows.append(row)
    return rows


def safe_float(val, default=0.0):
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def safe_int(val, default=0):
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


def generate_player_segments():
    players = load_csv("kb_players.csv")
    segments = defaultdict(list)
    for p in players:
        segments[p.get("segment", "unknown")].append(p)

    lines = ["# Player Segments Analysis\n", f"Total players: {len(players)}\n"]
    for seg_name in ["whale", "dolphin", "f2p_hardcore", "casual"]:
        seg = segments.get(seg_name, [])
        if not seg:
            continue
        levels = [safe_int(p.get("player_level", 0)) for p in seg]
        cp = [safe_int(p.get("combat_power", 0)) for p in seg]
        ranks = [safe_int(p.get("arena_rank", 0)) for p in seg]
        chars = [safe_int(p.get("characters_owned", 0)) for p in seg]
        legendary = [safe_int(p.get("legendary_heroes_owned", 0)) for p in seg]
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
        lines.append(f"- Avg legendary heroes: {sum(legendary) / len(legendary):.1f}")
        lines.append(f"- Combat power range: {min(cp):,} to {max(cp):,}")
        lines.append(
            f"- Countries: {dict(sorted(countries.items(), key=lambda x: -x[1]))}"
        )
        lines.append(f"- Platforms: {dict(platforms)}")
        lines.append(
            f"- Top guilds: {dict(sorted(guilds.items(), key=lambda x: -x[1])[:5])}"
        )
        top = sorted(
            seg, key=lambda x: safe_int(x.get("combat_power", 0)), reverse=True
        )[:5]
        lines.append(f"\n### Top {seg_name} players:")
        for p in top:
            lines.append(
                f"- {p.get('player_id', '')} ({p.get('username', '')}) — Level {p.get('player_level')}, "
                f"CP {safe_int(p.get('combat_power', 0)):,}, Rank {p.get('arena_rank')}, "
                f"{p.get('characters_owned')} chars, {p.get('legendary_heroes_owned')} legendary, "
                f"Guild: {p.get('guild_id')}, {p.get('country')}, {p.get('platform')}"
            )
        lines.append("")

    with open(OUTPUT_DIR / "player_segments_analysis.md", "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("Generated player_segments_analysis.md")


def generate_country_analysis():
    players = load_csv("kb_players.csv")
    country_data = defaultdict(list)
    for p in players:
        country_data[p.get("country", "unknown")].append(p)

    lines = ["# Player Distribution by Country\n"]
    for country in sorted(country_data.keys()):
        cp_list = country_data[country]
        segs = defaultdict(int)
        for p in cp_list:
            segs[p.get("segment", "")] += 1
        cps = [safe_int(p.get("combat_power", 0)) for p in cp_list]
        plats = defaultdict(int)
        for p in cp_list:
            plats[p.get("platform", "")] += 1
        lines.append(f"## {country}\n- Players: {len(cp_list)}")
        lines.append(f"- Segments: {dict(segs)}")
        lines.append(f"- Platforms: {dict(plats)}")
        lines.append(f"- Avg CP: {sum(cps) / len(cps):,.0f}\n")

    with open(OUTPUT_DIR / "player_country_analysis.md", "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("Generated player_country_analysis.md")


def generate_campaigns():
    campaigns = load_csv("kb_campaigns.csv")
    acquisitions = load_csv("kb_user_acquisition.csv")
    camp_acq = defaultdict(list)
    for a in acquisitions:
        camp_acq[a.get("campaign_id", "")].append(a)

    lines = ["# Campaign Performance Analysis\n"]
    for c in campaigns:
        cid = c.get("campaign_id", "")
        acqs = camp_acq.get(cid, [])
        lines.append(f"## {c.get('campaign_name', cid)} ({cid})\n")
        lines.append(
            f"- Type: {c.get('campaign_type')}, Budget: ${safe_float(c.get('budget', 0)):,.2f}"
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
                safe_float(a.get("lifetime_value", 0))
                for a in acqs
                if a.get("lifetime_value")
            ]
            cpis = [
                safe_float(a.get("cost_per_install", 0))
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

    with open(
        OUTPUT_DIR / "campaign_performance_analysis.md", "w", encoding="utf-8"
    ) as f:
        f.write("\n".join(lines))
    print("Generated campaign_performance_analysis.md")


def generate_acquisition_channels():
    acquisitions = load_csv("kb_user_acquisition.csv")
    channels = defaultdict(list)
    for a in acquisitions:
        channels[a.get("acquisition_channel", "unknown")].append(a)

    lines = ["# User Acquisition Channel Analysis\n"]
    for ch, acqs in sorted(channels.items()):
        cpis = [
            safe_float(a.get("cost_per_install", 0))
            for a in acqs
            if a.get("cost_per_install")
        ]
        ltvs = [
            safe_float(a.get("lifetime_value", 0))
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

    with open(
        OUTPUT_DIR / "acquisition_channels_analysis.md", "w", encoding="utf-8"
    ) as f:
        f.write("\n".join(lines))
    print("Generated acquisition_channels_analysis.md")


def generate_monetization():
    players = load_csv("kb_players.csv")
    purchases = load_csv("kb_purchases.csv")
    monetization = load_csv("kb_monetization_events.csv")
    player_seg = {p.get("player_id", ""): p.get("segment", "unknown") for p in players}

    lines = ["# Monetization & Purchase Analysis\n"]

    if purchases:
        cats = defaultdict(list)
        for p in purchases:
            cats[p.get("item_category", "unknown")].append(p)
        lines.append("## By Item Category\n")
        for cat, txns in sorted(cats.items()):
            prices = [safe_float(t.get("price", t.get("price_usd", 0))) for t in txns]
            prices = [p for p in prices if p > 0]
            if prices:
                lines.append(
                    f"- {cat}: {len(txns)} txns, avg ${sum(prices) / len(prices):.2f}, total ${sum(prices):,.2f}"
                )
        lines.append("")

        # By item name
        items = defaultdict(list)
        for p in purchases:
            items[p.get("item_name", "unknown")].append(p)
        lines.append("## By Item Name\n")
        for item, txns in sorted(items.items(), key=lambda x: -len(x[1])):
            prices = [safe_float(t.get("price", t.get("price_usd", 0))) for t in txns]
            prices = [p for p in prices if p > 0]
            if prices:
                lines.append(
                    f"- {item}: {len(txns)} txns, avg ${sum(prices) / len(prices):.2f}, range ${min(prices):.2f}-${max(prices):.2f}, total ${sum(prices):,.2f}"
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
                    safe_float(t.get("price", t.get("price_usd", 0))) for t in txns
                ]
                prices = [p for p in prices if p > 0]
                if prices:
                    lines.append(
                        f"- {seg}: {len(txns)} txns, avg ${sum(prices) / len(prices):.2f}, total ${sum(prices):,.2f}"
                    )
        lines.append("")

        # By platform
        plat_p = defaultdict(list)
        for p in purchases:
            plat_p[p.get("platform", "unknown")].append(p)
        lines.append("## By Platform\n")
        for plat, txns in plat_p.items():
            prices = [safe_float(t.get("price", t.get("price_usd", 0))) for t in txns]
            prices = [p for p in prices if p > 0]
            if prices:
                lines.append(
                    f"- {plat}: {len(txns)} txns, avg ${sum(prices) / len(prices):.2f}, total ${sum(prices):,.2f}"
                )
        lines.append("")

    if monetization:
        seg_events = defaultdict(lambda: {"purchased": 0, "declined": 0, "spend": 0.0})
        for m in monetization:
            seg = m.get("segment_classification", "unknown")
            if m.get("purchase_decision") == "purchased":
                seg_events[seg]["purchased"] += 1
                seg_events[seg]["spend"] += safe_float(
                    m.get("amount_usd", m.get("price", 0))
                )
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

    with open(OUTPUT_DIR / "monetization_analysis.md", "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("Generated monetization_analysis.md")


def generate_incidents():
    incidents = load_csv("kb_incidents.csv")
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
            f"- Status: {inc.get('status', inc.get('resolution_status'))}, Compensation: ${safe_float(inc.get('compensation_amount', 0)):,.2f}"
        )
        lines.append(f"- Start: {inc.get('start_time', '')}")
        lines.append(f"- End: {inc.get('end_time', inc.get('resolution_time', ''))}")
        lines.append(f"- Description: {inc.get('description', '')[:500]}")
        lines.append(f"- Root cause: {inc.get('root_cause', 'N/A')}\n")
        if (
            inc.get("compensation_given") == "True"
            or safe_float(inc.get("compensation_amount", 0)) > 0
        ):
            compensated.append(inc)

    if compensated:
        lines.append("## Incidents with Compensation\n")
        for inc in compensated:
            lines.append(
                f"- {inc['incident_id']}: {inc.get('incident_type')} ({inc.get('severity')}), "
                f"{inc.get('affected_players')} affected, ${safe_float(inc.get('compensation_amount', 0)):,.2f}"
            )
    lines.append("")

    with open(OUTPUT_DIR / "incident_analysis.md", "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("Generated incident_analysis.md")


def generate_gameplay_sessions():
    gameplay = load_csv("kb_gameplay.csv")
    sessions = load_csv("kb_session_details.csv")
    arena = load_csv("kb_arena_battles.csv")
    guild = load_csv("kb_guild_activities.csv")
    events = load_csv("kb_event_participation.csv")
    daily = load_csv("kb_daily_activities.csv")
    social = load_csv("kb_social_interactions.csv")
    characters = load_csv("kb_character_interactions.csv")

    lines = ["# Gameplay & Session Analysis\n"]

    if gameplay:
        modes = defaultdict(list)
        for g in gameplay:
            modes[g.get("game_mode", "unknown")].append(g)
        for mode, entries in sorted(modes.items()):
            durs = [
                safe_float(
                    e.get("session_duration_minutes", e.get("duration_minutes", 0))
                )
                for e in entries
            ]
            lines.append(
                f"## {mode}\n- Sessions: {len(entries)}, Avg duration: {sum(durs) / len(durs):.1f} min"
            )
            lines.append(f"- Duration range: {min(durs):.1f} to {max(durs):.1f} min\n")

    if sessions:
        devices = defaultdict(int)
        platforms = defaultdict(int)
        networks = defaultdict(int)
        for s in sessions:
            devices[s.get("device_model", "")] += 1
            platforms[s.get("platform", "")] += 1
            networks[s.get("network_type", "")] += 1
        durs = [safe_float(s.get("session_duration_minutes", 0)) for s in sessions]
        lines.append(
            f"## Session Overview\n- Total: {len(sessions)}, Avg duration: {sum(durs) / len(durs):.1f} min"
        )
        lines.append(
            f"- Devices: {dict(sorted(devices.items(), key=lambda x: -x[1])[:8])}"
        )
        lines.append(f"- Platforms: {dict(platforms)}")
        lines.append(f"- Networks: {dict(networks)}\n")

    if arena:
        arena_types = defaultdict(list)
        for a in arena:
            arena_types[a.get("battle_type", "unknown")].append(a)
        lines.append("## Arena Battles\n")
        lines.append(f"Total battles: {len(arena)}\n")
        for bt, battles in arena_types.items():
            avg_dur = sum(
                safe_float(a.get("battle_duration_seconds", 0)) for a in battles
            ) / len(battles)
            wins = sum(1 for a in battles if a.get("result") == "win")
            lines.append(
                f"- {bt}: {len(battles)} battles, avg {avg_dur:.0f}s, win rate {wins / len(battles) * 100:.1f}%"
            )
        lines.append("")

    if guild:
        guild_types = Counter(g.get("activity_type", "unknown") for g in guild)
        lines.append("## Guild Activities\n")
        for gt, count in guild_types.most_common():
            lines.append(f"- {gt}: {count}")
        lines.append("")

    if events:
        event_names = Counter(e.get("event_name", "unknown") for e in events)
        lines.append("## Events\n")
        for en, count in event_names.most_common():
            ev_list = [e for e in events if e.get("event_name") == en]
            event_types = set(e.get("event_type", "") for e in ev_list)
            lines.append(f"- {en} ({', '.join(event_types)}): {count} participations")
        lines.append("")

    if daily:
        activity_types = Counter(d.get("activity_type", "unknown") for d in daily)
        lines.append("## Daily Activities\n")
        for at, count in activity_types.most_common():
            lines.append(f"- {at}: {count} records")
        lines.append("")

    if social:
        social_types = Counter(s.get("interaction_type", "unknown") for s in social)
        lines.append("## Social Interactions\n")
        lines.append(f"Total: {len(social)}\n")
        for st, count in social_types.most_common():
            interactions = [s for s in social if s.get("interaction_type") == st]
            sentiments = Counter(s.get("sentiment", "unknown") for s in interactions)
            lines.append(
                f"- {st}: {count} (sentiment: {', '.join(f'{k}={v}' for k, v in sentiments.most_common())})"
            )
        lines.append("")

    if characters:
        char_types = Counter(c.get("interaction_type", "unknown") for c in characters)
        char_names = Counter(c.get("character_name", "unknown") for c in characters)
        lines.append("## Character Interactions\n")
        lines.append(f"Total: {len(characters)}\n")
        lines.append("### By Type\n")
        for ct, count in char_types.most_common():
            lines.append(f"- {ct}: {count}")
        lines.append("\n### Most Popular Characters\n")
        for cn, count in char_names.most_common(10):
            lines.append(f"- {cn}: {count} interactions")
        lines.append("")

    with open(OUTPUT_DIR / "gameplay_session_analysis.md", "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("Generated gameplay_session_analysis.md")


def generate_kpi_reference():
    players = load_csv("kb_players.csv")
    purchases = load_csv("kb_purchases.csv")
    acquisitions = load_csv("kb_user_acquisition.csv")

    lines = ["# Key Performance Indicators (KPIs) Reference\n"]

    if players:
        segs = defaultdict(int)
        for p in players:
            segs[p.get("segment", "")] += 1
        plats = defaultdict(int)
        for p in players:
            plats[p.get("platform", "")] += 1
        lines.append(f"## Players\n- Total: {len(players)}, Segments: {dict(segs)}")
        lines.append(f"- Platforms: {dict(plats)}\n")

    if purchases:
        prices = [safe_float(p.get("price", p.get("price_usd", 0))) for p in purchases]
        prices = [p for p in prices if p > 0]
        if prices:
            lines.append(
                f"## Revenue\n- Total purchases: {len(prices)}, Total: ${sum(prices):,.2f}"
            )
            if players:
                lines.append(f"- ARPU: ${sum(prices) / len(players):.2f}")
            unique_buyers = len(set(p.get("player_id") for p in purchases))
            lines.append(f"- Unique buyers: {unique_buyers}")
            if unique_buyers:
                lines.append(f"- ARPPU: ${sum(prices) / unique_buyers:.2f}\n")

    if acquisitions:
        d1 = sum(1 for a in acquisitions if a.get("retention_d1") == "True")
        d7 = sum(1 for a in acquisitions if a.get("retention_d7") == "True")
        d30 = sum(1 for a in acquisitions if a.get("retention_d30") == "True")
        total = len(acquisitions)
        lines.append(
            f"## Retention\n- D1: {d1 / total * 100:.1f}%, D7: {d7 / total * 100:.1f}%, D30: {d30 / total * 100:.1f}%\n"
        )

        # By segment
        player_map = {p.get("player_id"): p for p in load_csv("kb_players.csv")}
        seg_ret = defaultdict(lambda: {"total": 0, "d1": 0, "d7": 0, "d30": 0})
        for a in acquisitions:
            p = player_map.get(a.get("player_id"), {})
            seg = p.get("segment", "unknown")
            seg_ret[seg]["total"] += 1
            if a.get("retention_d1") == "True":
                seg_ret[seg]["d1"] += 1
            if a.get("retention_d7") == "True":
                seg_ret[seg]["d7"] += 1
            if a.get("retention_d30") == "True":
                seg_ret[seg]["d30"] += 1
        lines.append("## Retention by Segment\n")
        for seg in ["whale", "dolphin", "f2p_hardcore", "casual"]:
            s = seg_ret.get(seg, {"total": 0, "d1": 0, "d7": 0, "d30": 0})
            t = max(s["total"], 1)
            lines.append(
                f"- {seg}: D1 {s['d1'] / t * 100:.0f}%, D7 {s['d7'] / t * 100:.0f}%, D30 {s['d30'] / t * 100:.0f}% (n={s['total']})"
            )
        lines.append("")

    with open(OUTPUT_DIR / "kpi_reference.md", "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("Generated kpi_reference.md")


if __name__ == "__main__":
    # Clean old summaries
    for f in OUTPUT_DIR.glob("*.md"):
        f.unlink()

    generate_player_segments()
    generate_country_analysis()
    generate_campaigns()
    generate_acquisition_channels()
    generate_monetization()
    generate_incidents()
    generate_gameplay_sessions()
    generate_kpi_reference()
    print(f"\nAll summaries generated in {OUTPUT_DIR}/")
