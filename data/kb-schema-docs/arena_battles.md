# Table: liveops.arena_battles

**Data Store**: liveops (AWS Athena / Glue)
**Database**: liveops
**Schema**: default

## Description

Records of PvP arena battles between players. Tracks battle outcomes, rank changes, team power comparisons, duration, and rewards earned. Used for competitive balance analysis and matchmaking evaluation.

## Columns

| Column                  | Type   | Nullable | Description                                          | Business Term   |
| ----------------------- | ------ | -------- | ---------------------------------------------------- | --------------- |
| battle_id               | string | No       | Unique battle identifier (UUID)                      | Battle ID       |
| player_id               | string | No       | Player who initiated the battle                      | Player ID       |
| battle_type             | string | No       | Type of arena battle (e.g. squad_arena, fleet_arena) | Battle Type     |
| battle_timestamp        | string | No       | ISO 8601 timestamp when battle occurred              | Battle Time     |
| opponent_player_id      | string | No       | Player ID of the opponent                            | Opponent ID     |
| player_rank_before      | int    | Yes      | Player's arena rank before the battle                | Rank Before     |
| player_rank_after       | int    | Yes      | Player's arena rank after the battle                 | Rank After      |
| battle_result           | string | No       | Outcome: win, loss, draw                             | Battle Result   |
| team_power_used         | bigint | Yes      | Total power of the player's team                     | Team Power      |
| opponent_team_power     | bigint | Yes      | Total power of the opponent's team                   | Opponent Power  |
| battle_duration_seconds | int    | Yes      | Duration of the battle in seconds                    | Duration        |
| crystals_earned         | int    | Yes      | Crystal rewards earned from the battle               | Crystals Earned |
| arena_tokens_earned     | int    | Yes      | Arena-specific currency earned                       | Arena Tokens    |
| characters_used         | string | Yes      | Comma-separated list of characters deployed          | Characters Used |
| strategy_effectiveness  | double | Yes      | Calculated effectiveness score (0.0-1.0)             | Strategy Score  |

## Relationships

- player_id → players.player_id (FK)
- opponent_player_id → players.player_id (FK)

## Glossary

- **squad_arena**: Standard character-based PvP arena mode
- **fleet_arena**: Ship-based PvP arena mode
- **strategy_effectiveness**: Ratio measuring how well the player's team performed relative to power differential

## Notes

Key table for PvP balance analysis. Compare team_power_used vs opponent_team_power to evaluate matchmaking fairness. Rank changes (before/after) indicate ladder movement per battle.
