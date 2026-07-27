# Table: liveops.daily_activities

**Data Store**: liveops (AWS Athena / Glue)
**Database**: liveops
**Schema**: default

## Description

Daily player activity log tracking completion of recurring game tasks such as daily challenges, energy refreshes, and reward claims. Used to measure daily engagement depth and habit formation.

## Columns

| Column             | Type    | Nullable | Description                                                                   | Business Term     |
| ------------------ | ------- | -------- | ----------------------------------------------------------------------------- | ----------------- |
| activity_id        | string  | No       | Unique activity record identifier (UUID)                                      | Activity ID       |
| player_id          | string  | No       | Player who performed the activity                                             | Player ID         |
| activity_date      | string  | No       | Date the activity occurred (YYYY-MM-DD or ISO)                                | Activity Date     |
| activity_type      | string  | No       | Type of daily activity (e.g. daily_challenge, energy_refresh, guild_donation) | Activity Type     |
| activity_count     | int     | Yes      | Number of times the activity was performed that day                           | Activity Count    |
| points_earned      | int     | Yes      | Points or currency earned from the activity                                   | Points Earned     |
| time_spent_minutes | int     | Yes      | Minutes spent on this activity                                                | Time Spent        |
| completion_status  | string  | Yes      | Whether the activity was completed: completed, partial, skipped               | Completion Status |
| reward_claimed     | boolean | Yes      | Whether the player claimed the reward                                         | Reward Claimed    |

## Relationships

- player_id → players.player_id (FK)

## Glossary

- **daily_challenge**: Recurring tasks that reset each day
- **energy_refresh**: Using crystals or waiting to refill energy
- **guild_donation**: Contributing gear/materials to guildmates

## Notes

Key engagement metric table. Aggregating completion_status and reward_claimed by player segment reveals daily engagement patterns. High skip rates may signal churn risk.
