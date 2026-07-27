# Table: liveops.players

**Data Store**: liveops (AWS Athena / Glue)
**Database**: liveops
**Schema**: default

## Description

Core player profile table containing account details, progression metrics, and segmentation data. Each row represents a unique player with their current state including level, arena rank, combat power, guild membership, and spending segment classification.

## Columns

| Column                 | Type   | Nullable | Description                                     | Business Term     |
| ---------------------- | ------ | -------- | ----------------------------------------------- | ----------------- |
| player_id              | string | No       | Unique player identifier (e.g. player_0001)     | Player ID         |
| username               | string | No       | Player display name                             | Username          |
| account_created        | string | No       | ISO 8601 timestamp of account creation          | Registration Date |
| player_level           | int    | No       | Current player progression level (1-85)         | Player Level      |
| arena_rank             | int    | Yes      | Current PvP arena ranking position              | Arena Rank        |
| combat_power           | bigint | Yes      | Aggregate power score across all characters     | Combat Power      |
| guild_id               | string | Yes      | Guild the player belongs to (null if unguilded) | Guild ID          |
| country                | string | Yes      | Two-letter country code (e.g. US, KR, AU)       | Country           |
| platform               | string | Yes      | Device platform: ios, android                   | Platform          |
| segment                | string | Yes      | Spending segment: whale, dolphin, minnow, free  | Player Segment    |
| last_login             | string | Yes      | ISO 8601 timestamp of most recent login         | Last Login        |
| characters_owned       | int    | Yes      | Total number of characters unlocked             | Characters Owned  |
| legendary_heroes_owned | int    | Yes      | Number of legendary-tier characters owned       | Legendary Heroes  |

## Relationships

- player_id → arena_battles.player_id (referenced)
- player_id → gameplay.player_id (referenced)
- player_id → purchases.player_id (referenced)
- player_id → session_details.player_id (referenced)
- player_id → monetization_events.player_id (referenced)
- player_id → daily_activities.player_id (referenced)
- player_id → character_interactions.player_id (referenced)
- player_id → guild_activities.player_id (referenced)
- player_id → social_interactions.player_id (referenced)
- player_id → event_participation.player_id (referenced)
- player_id → user_acquisition.player_id (referenced)
- guild_id → guild_activities.guild_id (referenced)

## Glossary

- **whale**: High-spending player segment (top tier)
- **dolphin**: Moderate-spending player segment
- **minnow**: Low-spending player segment
- **free**: Non-spending (free-to-play) player segment
- **combat_power**: Aggregate numeric score representing total character strength

## Notes

Central dimension table for the gaming analytics schema. Most other tables reference player_id from this table. The segment field is critical for monetization and retention analysis. Country and platform enable geographic and device-level breakdowns.
