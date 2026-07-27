# Table: liveops.character_interactions

**Data Store**: liveops (AWS Athena / Glue)
**Database**: liveops
**Schema**: default

## Description

Tracks player interactions with game characters including upgrades, gear applications, and progression changes. Each row captures a before/after snapshot of character stats when a player modifies a character.

## Columns

| Column                | Type   | Nullable | Description                                                                  | Business Term    |
| --------------------- | ------ | -------- | ---------------------------------------------------------------------------- | ---------------- |
| interaction_id        | string | No       | Unique interaction identifier (UUID)                                         | Interaction ID   |
| player_id             | string | No       | Player performing the interaction                                            | Player ID        |
| character_name        | string | No       | Name of the character being modified                                         | Character Name   |
| interaction_type      | string | No       | Type of interaction (e.g. level_up, gear_equip, star_promote, relic_upgrade) | Interaction Type |
| interaction_timestamp | string | No       | ISO 8601 timestamp of the interaction                                        | Interaction Time |
| level_before          | int    | Yes      | Character level before the interaction                                       | Level Before     |
| level_after           | int    | Yes      | Character level after the interaction                                        | Level After      |
| power_before          | bigint | Yes      | Character power score before                                                 | Power Before     |
| power_after           | bigint | Yes      | Character power score after                                                  | Power After      |
| star_level_before     | int    | Yes      | Character star rating before (1-7)                                           | Star Before      |
| star_level_after      | int    | Yes      | Character star rating after (1-7)                                            | Star After       |
| relic_level_before    | int    | Yes      | Relic tier before the interaction                                            | Relic Before     |
| relic_level_after     | int    | Yes      | Relic tier after the interaction                                             | Relic After      |
| gear_pieces_applied   | int    | Yes      | Number of gear pieces equipped in this interaction                           | Gear Applied     |
| credits_spent         | bigint | Yes      | In-game credits consumed                                                     | Credits Spent    |
| materials_used        | int    | Yes      | Number of upgrade materials consumed                                         | Materials Used   |

## Relationships

- player_id → players.player_id (FK)

## Glossary

- **star_promote**: Increasing a character's star level (rarity upgrade)
- **relic_upgrade**: Applying relic tiers to a max-gear character
- **gear_equip**: Equipping gear pieces to increase character gear level
- **level_up**: Spending credits/materials to increase character level

## Notes

High-volume table useful for understanding player investment patterns. The before/after columns enable delta analysis on character progression. Join with players to segment upgrade behavior by whale/dolphin/minnow/free.
