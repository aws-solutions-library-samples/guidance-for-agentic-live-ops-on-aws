# Table: liveops.gameplay

**Data Store**: liveops (AWS Athena / Glue)
**Database**: liveops
**Schema**: default

## Description

Per-session gameplay records capturing game mode, duration, battle outcomes, and resource consumption. Core table for understanding how players spend their time and energy across different game modes.

## Columns

| Column            | Type   | Nullable | Description                                                               | Business Term   |
| ----------------- | ------ | -------- | ------------------------------------------------------------------------- | --------------- |
| gameplay_id       | string | No       | Unique gameplay session identifier (UUID)                                 | Gameplay ID     |
| player_id         | string | No       | Player who played the session                                             | Player ID       |
| session_date      | string | No       | Date/time of the gameplay session                                         | Session Date    |
| game_mode         | string | No       | Game mode played (e.g. arena_battles, fleet_battles, galactic_war, raids) | Game Mode       |
| duration_minutes  | double | Yes      | Length of the gameplay session in minutes                                 | Duration        |
| battles_fought    | int    | Yes      | Number of battles in this session                                         | Battles Fought  |
| battles_won       | int    | Yes      | Number of battles won                                                     | Battles Won     |
| experience_gained | bigint | Yes      | Total XP earned during the session                                        | XP Gained       |
| credits_earned    | bigint | Yes      | In-game credits earned                                                    | Credits Earned  |
| energy_consumed   | int    | Yes      | Energy points spent                                                       | Energy Used     |
| characters_used   | string | Yes      | Number of unique characters deployed (stored as string)                   | Characters Used |
| difficulty_level  | string | Yes      | Difficulty setting: easy, normal, hard                                    | Difficulty      |

## Relationships

- player_id → players.player_id (FK)

## Glossary

- **arena_battles**: PvP squad arena mode
- **fleet_battles**: PvP ship arena mode
- **galactic_war**: PvE progressive battle mode
- **raids**: Cooperative guild boss encounters
- **energy**: Gated resource that limits daily play volume

## Notes

Primary engagement metrics table. Win rate (battles_won / battles_fought) by game_mode and difficulty_level reveals balance issues. Energy_consumed correlates with monetization (players buy energy refills).
