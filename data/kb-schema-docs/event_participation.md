# Table: liveops.event_participation

**Data Store**: liveops (AWS Athena / Glue)
**Database**: liveops
**Schema**: default

## Description

Records player participation in limited-time game events including tournaments, special challenges, and seasonal content. Tracks scores, rankings, rewards, and completion rates per event.

## Columns

| Column                | Type   | Nullable | Description                                                             | Business Term       |
| --------------------- | ------ | -------- | ----------------------------------------------------------------------- | ------------------- |
| event_id              | string | No       | Unique event instance identifier                                        | Event ID            |
| player_id             | string | No       | Participating player                                                    | Player ID           |
| event_name            | string | No       | Display name of the event                                               | Event Name          |
| event_type            | string | No       | Category of event (e.g. tournament, raid, conquest, galactic_challenge) | Event Type          |
| participation_date    | string | No       | Date the player participated                                            | Participation Date  |
| participation_level   | string | Yes      | Tier or difficulty level attempted                                      | Participation Level |
| score_achieved        | int    | Yes      | Player's score in the event                                             | Score               |
| rank_achieved         | int    | Yes      | Player's rank among participants                                        | Rank                |
| rewards_earned        | int    | Yes      | Reward currency/items earned                                            | Rewards Earned      |
| completion_percentage | double | Yes      | Percentage of event milestones completed (0.0-1.0)                      | Completion %        |

## Relationships

- player_id → players.player_id (FK)

## Glossary

- **tournament**: Competitive ranked event with leaderboard
- **raid**: Cooperative guild-based boss encounter
- **conquest**: Territory-based strategic event
- **galactic_challenge**: Rotating challenge with specific character requirements

## Notes

Useful for measuring event engagement and reward economy balance. Low completion_percentage across segments may indicate event difficulty tuning issues. Join with players for segment-level event analysis.
