# Table: liveops.user_acquisition

**Data Store**: liveops (AWS Athena / Glue)
**Database**: liveops
**Schema**: default

## Description

User acquisition funnel data linking players to their install source, campaign, cost, and early retention/monetization outcomes. Core table for marketing ROI and cohort analysis.

## Columns

| Column              | Type    | Nullable | Description                                                                                 | Business Term       |
| ------------------- | ------- | -------- | ------------------------------------------------------------------------------------------- | ------------------- |
| acquisition_id      | string  | No       | Unique acquisition record identifier                                                        | Acquisition ID      |
| player_id           | string  | No       | Acquired player                                                                             | Player ID           |
| install_date        | string  | No       | Date the player installed the game                                                          | Install Date        |
| acquisition_channel | string  | No       | Channel that drove the install (e.g. organic, paid_social, influencer, search, cross_promo) | Acquisition Channel |
| campaign_id         | string  | Yes      | Associated marketing campaign (null for organic)                                            | Campaign ID         |
| cost_per_install    | double  | Yes      | CPI — cost to acquire this player in USD                                                    | CPI                 |
| lifetime_value      | double  | Yes      | Predicted or actual LTV in USD                                                              | LTV                 |
| retention_d1        | boolean | Yes      | Whether the player returned on day 1 after install                                          | D1 Retention        |
| retention_d7        | boolean | Yes      | Whether the player returned on day 7 after install                                          | D7 Retention        |
| retention_d30       | boolean | Yes      | Whether the player returned on day 30 after install                                         | D30 Retention       |
| first_purchase_date | string  | Yes      | Date of the player's first purchase (null if free)                                          | First Purchase Date |
| country             | string  | Yes      | Two-letter country code                                                                     | Country             |
| platform            | string  | Yes      | Platform: ios, android                                                                      | Platform            |

## Relationships

- player_id → players.player_id (FK)
- campaign_id → campaigns.campaign_id (FK)

## Glossary

- **CPI**: Cost Per Install — marketing spend divided by installs attributed to that spend
- **LTV**: Lifetime Value — total revenue expected from a player over their lifetime
- **D1/D7/D30 Retention**: Whether the player was active 1, 7, or 30 days after install
- **organic**: Installs not attributed to any paid marketing campaign
- **cross_promo**: Installs driven by promotion within other games in the portfolio

## Notes

Join with campaigns on campaign_id for full marketing funnel analysis. LTV / CPI ratio indicates campaign profitability. Retention flags (d1, d7, d30) are the standard mobile gaming retention benchmarks. Filter by country and platform for geo/device-level acquisition analysis.
