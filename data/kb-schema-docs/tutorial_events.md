# Table: liveops.tutorial_events

**Data Store**: liveops (AWS Athena / Glue)
**Database**: liveops
**Schema**: default

## Description

Event log of the new-player tutorial. One row per step attempt: completions, failed battle attempts, skipped optional modules, and the step where a player quit. Core table for tutorial funnels, step orders, transitions and retry loops.

## Columns

| Column           | Type   | Nullable | Description                                                                       | Business Term    |
| ---------------- | ------ | -------- | --------------------------------------------------------------------------------- | ---------------- |
| event_id         | string | No       | Unique event identifier                                                           | Event ID         |
| player_id        | string | No       | Tutorial player (tp\_ prefix, separate from liveops.players)                      | Tutorial Player  |
| step_id          | string | No       | Tutorial step                                                                     | Tutorial Step    |
| event_type       | string | No       | complete, fail, skip, or quit (the step where the player left and never returned) | Step Outcome     |
| event_timestamp  | string | No       | ISO 8601 UTC timestamp; parse with from_iso8601_timestamp()                       | Event Time       |
| step_seq         | int    | No       | Order of the event within the player's tutorial journey                           | Step Sequence    |
| attempt_number   | int    | No       | Attempt count for retryable steps (first_battle, boss_battle)                     | Attempt Number   |
| duration_seconds | int    | No       | Time spent on this attempt in seconds                                             | Step Duration    |
| session_number   | int    | No       | Session in which the event happened                                               | Session Number   |
| tutorial_version | string | No       | Tutorial build: v1, or v2 (from 2025-09-25, shorter craft_item step)              | Tutorial Version |

## Relationships

- step_id → tutorial_steps.step_id (FK)
- player_id → tutorial_players.player_id (FK)

## Glossary

- **Drop-off**: A player quitting the tutorial at a step (event_type = quit)
- **Retry loop**: Repeated fail events on the same step before a complete
- **Transition**: Movement from one step to the next, found with LEAD(step_id) ordered by step_seq

## Notes

Order a player's events by step_seq. A self-transition (same step twice in a row) is a retry loop. Skipped optional modules appear as a single skip event on the module's entry step (gather_resources or join_guild). Tutorial players do not exist in other game tables, so do not join to liveops.players.
