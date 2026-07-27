# Table: liveops.campaigns

**Data Store**: liveops (AWS Athena / Glue)
**Database**: liveops
**Schema**: default

## Description

Marketing campaign definitions including budget, targeting, channel, and status. Used to track user acquisition campaigns and correlate with player acquisition and monetization outcomes.

## Columns

| Column          | Type   | Nullable | Description                                                       | Business Term   |
| --------------- | ------ | -------- | ----------------------------------------------------------------- | --------------- |
| campaign_id     | string | No       | Unique campaign identifier                                        | Campaign ID     |
| campaign_name   | string | No       | Human-readable campaign name                                      | Campaign Name   |
| campaign_type   | string | No       | Category of campaign (e.g. acquisition, retention, re-engagement) | Campaign Type   |
| start_date      | string | No       | Campaign start date (ISO format)                                  | Start Date      |
| end_date        | string | Yes      | Campaign end date (ISO format, null if ongoing)                   | End Date        |
| budget          | double | Yes      | Total campaign budget in USD                                      | Budget          |
| target_audience | string | Yes      | Target player segment or demographic                              | Target Audience |
| channel         | string | Yes      | Marketing channel (e.g. social_media, search, influencer)         | Channel         |
| status          | string | No       | Campaign status: active, completed, paused                        | Status          |

## Relationships

- campaign_id → user_acquisition.campaign_id (referenced)

## Glossary

- **acquisition**: Campaign aimed at acquiring new players
- **retention**: Campaign aimed at keeping existing players engaged
- **re-engagement**: Campaign aimed at bringing back lapsed players

## Notes

Dimension table for marketing analytics. Join with user_acquisition on campaign_id to measure campaign effectiveness (CPI, LTV, retention rates).
