-- Gaming Analytics — Monetization & Incident Tables
-- Source: AWS Glue / Athena (gaming_analytics database)

CREATE EXTERNAL TABLE gaming_analytics.purchases (
    purchase_id         STRING      NOT NULL,
    player_id           STRING      NOT NULL,
    purchase_date       STRING      NOT NULL,
    item_name           STRING      NOT NULL,
    item_category       STRING      NOT NULL COMMENT 'crystals, energy, gear, characters, bundles',
    price_usd           DOUBLE      NOT NULL,
    currency_type       STRING               COMMENT 'usd, eur, gbp, etc.',
    payment_method      STRING               COMMENT 'credit_card, app_store, google_play',
    transaction_status  STRING      NOT NULL COMMENT 'completed, failed, refunded, pending',
    platform            STRING,
    country             STRING,
    FOREIGN KEY (player_id) REFERENCES gaming_analytics.players(player_id)
);

CREATE EXTERNAL TABLE gaming_analytics.monetization_events (
    transaction_id          STRING      NOT NULL,
    player_id               STRING      NOT NULL,
    transaction_timestamp   STRING      NOT NULL,
    purchase_type           STRING      NOT NULL COMMENT 'crystal_pack, energy_refill, character_bundle, gear_pack',
    item_considered         STRING,
    amount_usd              DOUBLE,
    purchase_decision       STRING      NOT NULL COMMENT 'purchased, abandoned, declined',
    payment_method          STRING,
    first_time_purchase     BOOLEAN              COMMENT 'Whether this is the players first ever purchase',
    player_level_at_purchase INT,
    days_since_install      INT,
    segment_classification  STRING               COMMENT 'Player spending segment at time of event',
    FOREIGN KEY (player_id) REFERENCES gaming_analytics.players(player_id)
);

CREATE EXTERNAL TABLE gaming_analytics.incidents (
    incident_id         STRING      NOT NULL,
    incident_type       STRING      NOT NULL COMMENT 'server_outage, battle_error, purchase_failure, session_drop, api_abuse',
    severity            STRING      NOT NULL COMMENT 'critical, high, medium, low',
    start_time          STRING      NOT NULL,
    resolution_time     STRING               COMMENT 'Null if still ongoing',
    affected_players    INT,
    description         STRING,
    resolution_status   STRING      NOT NULL COMMENT 'resolved, investigating, mitigated',
    compensation_given  BOOLEAN,
    compensation_amount DOUBLE               COMMENT 'Value in USD equivalent'
);
