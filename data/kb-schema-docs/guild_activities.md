# Table: liveops.guild_activities

**Data Store**: liveops (AWS Athena / Glue)
**Database**: liveops
**Schema**: default

## Description

Tracks player participation in guild-based activities including raids, territory battles, territory wars, and resource donations. Measures individual contribution to guild objectives.

## Columns

| Column                         | Type   | Nullable | Description                                                                   | Business Term      |
| ------------------------------ | ------ | -------- | ----------------------------------------------------------------------------- | ------------------ |
| activity_id                    | string | No       | Unique guild activity record identifier (UUID)                                | Activity ID        |
| player_id                      | string | No       | Player who participated                                                       | Player ID          |
| guild_id                       | string | No       | Guild the activity was performed in                                           | Guild ID           |
| activity_type                  | string | No       | Type of guild activity (e.g. raid, territory_battle, territory_war, donation) | Activity Type      |
| activity_timestamp             | string | No       | ISO 8601 timestamp of the activity                                            | Activity Time      |
| contribution_score             | int    | Yes      | Points contributed to the guild objective                                     | Contribution Score |
| damage_dealt                   | bigint | Yes      | Damage dealt in raid/battle activities                                        | Damage Dealt       |
| energy_donated                 | int    | Yes      | Energy tickets donated to guildmates                                          | Energy Donated     |
| guild_tokens_earned            | int    | Yes      | Guild currency earned from participation                                      | Guild Tokens       |
| participation_rank             | int    | Yes      | Player's rank within the guild for this activity                              | Participation Rank |
| raid_tier                      | string | Yes      | Raid difficulty tier attempted (e.g. heroic, normal)                          | Raid Tier          |
| territory_battles_participated | int    | Yes      | Number of territory battle zones participated in                              | TB Zones           |
| territory_war_battles          | int    | Yes      | Number of territory war attacks/defenses                                      | TW Battles         |

## Relationships

- player_id → players.player_id (FK)
- guild_id → players.guild_id (FK)

## Glossary

- **territory_battle (TB)**: Cooperative guild PvE event on a strategic map
- **territory_war (TW)**: Competitive guild-vs-guild PvP event
- **raid**: Cooperative guild boss encounter with damage-based scoring
- **heroic**: Highest difficulty raid tier
- **guild_tokens**: Currency earned from guild activities, spent in guild store

## Notes

Guild engagement is a strong retention driver. Players with high contribution_score and participation_rank tend to have lower churn. Join with players on guild_id for guild-level aggregate analysis.
