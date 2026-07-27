# Table: liveops.session_details

**Data Store**: liveops (AWS Athena / Glue)
**Database**: liveops
**Schema**: default

## Description

Detailed session-level telemetry capturing device info, network conditions, activity counts, resource usage, and a computed session quality score. Used for session health analysis and technical performance monitoring.

## Columns

| Column                   | Type   | Nullable | Description                                                                | Business Term   |
| ------------------------ | ------ | -------- | -------------------------------------------------------------------------- | --------------- |
| session_id               | string | No       | Unique session identifier (UUID)                                           | Session ID      |
| player_id                | string | No       | Player who played the session                                              | Player ID       |
| session_start_time       | string | No       | ISO 8601 timestamp when session began                                      | Session Start   |
| session_end_time         | string | No       | ISO 8601 timestamp when session ended                                      | Session End     |
| session_duration_minutes | double | Yes      | Total session length in minutes                                            | Duration        |
| device_model             | string | Yes      | Device hardware model (e.g. iPhone 14, Galaxy S23)                         | Device Model    |
| platform                 | string | Yes      | Operating system: ios, android                                             | Platform        |
| network_type             | string | Yes      | Network connection type: wifi, cellular, 5g                                | Network Type    |
| activities_completed     | int    | Yes      | Number of distinct activities completed in the session                     | Activities Done |
| battles_fought           | int    | Yes      | Number of battles during the session                                       | Battles Fought  |
| energy_spent             | int    | Yes      | Energy consumed during the session                                         | Energy Spent    |
| crystals_spent           | int    | Yes      | Premium currency spent during the session                                  | Crystals Spent  |
| social_interactions      | int    | Yes      | Number of social actions (chat, guild, friend requests)                    | Social Actions  |
| session_quality_score    | double | Yes      | Computed quality score (0.0-1.0) based on latency, crashes, and engagement | Quality Score   |

## Relationships

- player_id → players.player_id (FK)

## Glossary

- **session_quality_score**: Composite metric factoring in connection stability, load times, crash-free rate, and engagement depth
- **crystals_spent**: Premium currency consumed (not purchased) during the session

## Notes

Key table for technical health and engagement depth analysis. Low session_quality_score correlated with network_type or device_model can identify performance issues. Session duration and activities_completed are core engagement KPIs.
