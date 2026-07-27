# Table: liveops.purchases

**Data Store**: liveops (AWS Athena / Glue)
**Database**: liveops
**Schema**: default

## Description

Completed in-app purchase transactions. Each row represents a successful (or failed) purchase with item details, pricing, payment method, and geographic context. Core revenue table.

## Columns

| Column             | Type   | Nullable | Description                                                         | Business Term      |
| ------------------ | ------ | -------- | ------------------------------------------------------------------- | ------------------ |
| purchase_id        | string | No       | Unique purchase identifier (UUID)                                   | Purchase ID        |
| player_id          | string | No       | Player who made the purchase                                        | Player ID          |
| purchase_date      | string | No       | Date/time of the purchase                                           | Purchase Date      |
| item_name          | string | No       | Name of the purchased item                                          | Item Name          |
| item_category      | string | No       | Category of item (e.g. crystals, energy, gear, characters, bundles) | Item Category      |
| price_usd          | double | No       | Purchase price in USD                                               | Price USD          |
| currency_type      | string | Yes      | Currency used: usd, eur, gbp, etc.                                  | Currency           |
| payment_method     | string | Yes      | Payment method: credit_card, app_store, google_play                 | Payment Method     |
| transaction_status | string | No       | Status: completed, failed, refunded, pending                        | Transaction Status |
| platform           | string | Yes      | Platform where purchase was made: ios, android                      | Platform           |
| country            | string | Yes      | Two-letter country code of the purchaser                            | Country            |

## Relationships

- player_id → players.player_id (FK)

## Glossary

- **crystals**: Premium in-game currency
- **energy**: Resource that gates daily play sessions
- **bundles**: Packaged offers containing multiple item types
- **refunded**: Transaction reversed after completion

## Notes

Primary revenue table. Sum price_usd by time period for gross revenue. Filter transaction_status = 'completed' for net revenue. Join with players for ARPU by segment. Geographic breakdown via country enables regional pricing analysis.
