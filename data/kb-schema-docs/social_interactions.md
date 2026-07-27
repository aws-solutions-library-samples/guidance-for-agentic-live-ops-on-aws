# Table: liveops.social_interactions

**Data Store**: liveops (AWS Athena / Glue)
**Database**: liveops
**Schema**: default

## Description

Player-to-player social interactions including chat messages, friend requests, guild communications, and other social actions. Tracks sentiment and influence metrics for social engagement analysis.

## Columns

| Column            | Type    | Nullable | Description                                                                   | Business Term     |
| ----------------- | ------- | -------- | ----------------------------------------------------------------------------- | ----------------- |
| interaction_id    | string  | No       | Unique interaction identifier (UUID)                                          | Interaction ID    |
| player_id         | string  | No       | Player who initiated the interaction                                          | Player ID         |
| target_player_id  | string  | No       | Player who received the interaction                                           | Target Player ID  |
| interaction_type  | string  | No       | Type of social action (e.g. chat_message, friend_request, guild_invite, gift) | Interaction Type  |
| interaction_date  | string  | No       | Date of the interaction                                                       | Interaction Date  |
| message_length    | int     | Yes      | Character count of the message (0 for non-message interactions)               | Message Length    |
| sentiment         | string  | Yes      | Detected sentiment: positive, neutral, negative                               | Sentiment         |
| response_received | boolean | Yes      | Whether the target player responded                                           | Response Received |
| guild_context     | boolean | Yes      | Whether the interaction occurred within a guild context                       | Guild Context     |
| influence_score   | double  | Yes      | Computed social influence score of the initiator (0.0-1.0)                    | Influence Score   |

## Relationships

- player_id → players.player_id (FK)
- target_player_id → players.player_id (FK)

## Glossary

- **influence_score**: Metric based on social graph centrality, response rates, and interaction volume
- **guild_context**: Interaction happened within guild chat or guild-related feature

## Notes

Social engagement is a strong predictor of retention. Players with high interaction volume and positive sentiment tend to have longer lifetimes. The influence_score can identify community leaders and potential brand advocates.
