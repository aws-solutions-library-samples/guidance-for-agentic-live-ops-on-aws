# Tutorial Progression Analysis

Synthetic first-time user experience (FTUE) tutorial data for a cohort of new installs from 2025-09-01 to 2025-10-15. Tables: liveops.tutorial_steps, liveops.tutorial_events, liveops.tutorial_players.

## Overall

- Players who started the tutorial: 4000
- Completed the tutorial: 2473 (61.8%)
- D1 retention: 44.0%
- D7 retention: 17.5%

## Funnel (players reaching each step, and quits at that step)

- 01 intro_cutscene (core): reached 4000, quit here 158 (4.0% of those who reached it)
- 02 movement_basics (core): reached 3842, quit here 97 (2.5% of those who reached it)
- 03 first_battle (core): reached 3745, quit here 183 (4.9% of those who reached it)
- 04 combat_skills (combat): reached 3256, quit here 56 (1.7% of those who reached it)
- 05 combo_attack (combat): reached 3200, quit here 65 (2.0% of those who reached it)
- 06 gather_resources (crafting): reached 3452, quit here 107 (3.1% of those who reached it)
- 07 craft_item (crafting): reached 2731, quit here 386 (14.1% of those who reached it)
- 08 join_guild (social): reached 3168, quit here 43 (1.4% of those who reached it)
- 09 guild_chat (social): reached 2333, quit here 22 (0.9% of those who reached it)
- 10 equip_gear (core): reached 2883, quit here 41 (1.4% of those who reached it)
- 11 first_quest (core): reached 2842, quit here 71 (2.5% of those who reached it)
- 12 boss_battle (core): reached 2771, quit here 180 (6.5% of those who reached it)
- 13 shop_intro (core): reached 2591, quit here 58 (2.2% of those who reached it)
- 14 hero_upgrade (core): reached 2533, quit here 40 (1.6% of those who reached it)
- 15 daily_rewards (core): reached 2493, quit here 20 (0.8% of those who reached it)
- 16 tutorial_complete (core): reached 2473, quit here 0 (0.0% of those who reached it)

## Top drop-off steps

- craft_item: 386 quits (9.7% of all players)
- first_battle: 183 quits (4.6% of all players)
- boss_battle: 180 quits (4.5% of all players)
- intro_cutscene: 158 quits (4.0% of all players)
- gather_resources: 107 quits (2.7% of all players)

## Completion by first module chosen

- combat first: 1569 players, completion 72.6%
- crafting first: 1093 players, completion 62.5%
- social first: 900 players, completion 72.3%

## Optional modules and D7 retention (completers only)

- Did crafting: 1957 players, D7 27.7%
- Skipped crafting: 516 players, D7 16.7%
- Joined a guild in the tutorial: 1819 players, D7 26.6%
- Did not join a guild: 654 players, D7 22.0%

## Battle retry loops

- 0 first_battle fails: 3138 players, D1 44.5%
- 1 first_battle fail: 644 players, D1 46.4%
- 2+ first_battle fails: 218 players, D1 30.3%
- Players who quit at boss_battle: 180

## Tutorial version (v2 launched 2025-09-25 with a shorter craft_item step)

- v1: 2201 players, completion 60.1%, craft_item quit rate 17.8%
- v2: 1799 players, completion 63.9%, craft_item quit rate 9.7%
