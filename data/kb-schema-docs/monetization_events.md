# Table: liveops.monetization_events

**Data Store**: liveops (AWS Athena / Glue)
**Database**: liveops
**Schema**: default

## Description

Tracks monetization funnel events including purchase considerations, decisions, and outcomes. Captures both completed purchases and abandoned/declined purchase attempts, enabling conversion funnel analysis.

## Columns

| Column                   | Type    | Nullable | Description                                                                          | Business Term      |
| ------------------------ | ------- | -------- | ------------------------------------------------------------------------------------ | ------------------ |
| transaction_id           | string  | No       | Unique transaction identifier (UUID)                                                 | Transaction ID     |
| player_id                | string  | No       | Player involved in the monetization event                                            | Player ID          |
| transaction_timestamp    | string  | No       | ISO 8601 timestamp of the event                                                      | Transaction Time   |
| purchase_type            | string  | No       | Category of purchase (e.g. crystal_pack, energy_refill, character_bundle, gear_pack) | Purchase Type      |
| item_considered          | string  | Yes      | Specific item the player viewed or considered                                        | Item Considered    |
| amount_usd               | double  | Yes      | Price in USD (0 if not purchased)                                                    | Amount USD         |
| purchase_decision        | string  | No       | Outcome: purchased, abandoned, declined                                              | Purchase Decision  |
| payment_method           | string  | Yes      | Payment method used (e.g. credit_card, app_store, google_play)                       | Payment Method     |
| first_time_purchase      | boolean | Yes      | Whether this is the player's first ever purchase                                     | First Purchase     |
| player_level_at_purchase | int     | Yes      | Player's level at time of the event                                                  | Level at Purchase  |
| days_since_install       | int     | Yes      | Days between account creation and this event                                         | Days Since Install |
| segment_classification   | string  | Yes      | Player spending segment at time of event                                             | Segment            |

## Relationships

- player_id → players.player_id (FK)

## Glossary

- **crystal_pack**: Premium currency bundle purchase
- **energy_refill**: Purchasing energy to continue playing
- **character_bundle**: Bundle containing character shards and materials
- **abandoned**: Player viewed the offer but did not complete purchase
- **declined**: Player explicitly dismissed the offer

## Notes

Critical for monetization funnel analysis. Compare purchased vs abandoned vs declined rates by purchase_type and segment_classification. The first_time_purchase flag identifies conversion events (free → paying). days_since_install helps model optimal monetization timing.
