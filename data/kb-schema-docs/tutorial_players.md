# Table: liveops.tutorial_players

**Data Store**: liveops (AWS Athena / Glue)
**Database**: liveops
**Schema**: default

## Description

One row per tutorial player with derived tutorial outcomes (path taken, skips, battle retries, completion) and early retention and purchase outcomes. Core table for comparing tutorial branches against D1/D7/D30 retention.

## Columns

| Column                 | Type   | Nullable | Description                                                                                      | Business Term       |
| ---------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------ | ------------------- |
| player_id              | string | No       | Tutorial player (tp\_ prefix)                                                                    | Tutorial Player     |
| install_date           | string | No       | Install date (YYYY-MM-DD)                                                                        | Install Date        |
| platform               | string | No       | ios or android                                                                                   | Platform            |
| country                | string | No       | Two-letter country code                                                                          | Country             |
| acquisition_channel    | string | No       | Install source (organic, facebook, google_ads, tiktok, unity_ads, cross_promo)                   | Acquisition Channel |
| tutorial_version       | string | No       | v1 or v2                                                                                         | Tutorial Version    |
| first_module           | string | Yes      | Hub module chosen first: combat, crafting, social; empty if the player quit before the hub       | First Branch        |
| module_order           | string | Yes      | Hub modules the player entered, in order (e.g. combat>social); empty if they quit before the hub | Tutorial Path       |
| skipped_crafting       | int    | No       | 1 if the optional crafting module was skipped                                                    | Skipped Crafting    |
| skipped_social         | int    | No       | 1 if the optional social module was skipped                                                      | Skipped Social      |
| first_battle_fails     | int    | No       | Failed first_battle attempts                                                                     | First Battle Fails  |
| boss_battle_fails      | int    | No       | Failed boss_battle attempts                                                                      | Boss Battle Fails   |
| completed_tutorial     | int    | No       | 1 if the player reached tutorial_complete                                                        | Tutorial Completion |
| last_step_id           | string | No       | tutorial_complete, or the step where the player quit                                             | Last Step           |
| steps_completed        | int    | No       | Distinct steps completed                                                                         | Steps Completed     |
| total_tutorial_minutes | double | No       | Total time spent in the tutorial                                                                 | Tutorial Time       |
| retention_d1           | int    | No       | 1 if the player returned on day 1                                                                | D1 Retention        |
| retention_d7           | int    | No       | 1 if the player returned on day 7                                                                | D7 Retention        |
| retention_d30          | int    | No       | 1 if the player returned on day 30                                                               | D30 Retention       |
| purchased_within_d7    | int    | No       | 1 if the player purchased within 7 days of install                                               | Early Purchase      |

## Relationships

- player_id is equivalent to tutorial_events.player_id
- last_step_id → tutorial_steps.step_id (FK)

## Glossary

- **Tutorial completion rate**: Share of players with completed_tutorial = 1
- **Branch**: The module order a player takes through the tutorial hub
- **D1/D7/D30 Retention**: Whether the player was active 1, 7, or 30 days after install

## Notes

Flags are 0/1 integers, so AVG(flag) gives a rate. When comparing optional modules against retention, filter completed_tutorial = 1. This cohort is synthetic and separate from liveops.players and liveops.user_acquisition.
