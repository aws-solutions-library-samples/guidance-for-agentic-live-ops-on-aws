-- Gaming Analytics — Player & Account Tables
-- Source: AWS Glue / Athena (gaming_analytics database)

CREATE EXTERNAL TABLE gaming_analytics.players (
    player_id       STRING      NOT NULL COMMENT 'Unique player identifier (e.g. player_0001)',
    username        STRING      NOT NULL COMMENT 'Player display name',
    account_created STRING      NOT NULL COMMENT 'ISO 8601 registration timestamp',
    player_level    INT                  COMMENT 'Current progression level (1-85)',
    arena_rank      INT                  COMMENT 'Current PvP arena ranking',
    combat_power    BIGINT               COMMENT 'Aggregate power score across all characters',
    guild_id        STRING               COMMENT 'Guild membership (null if unguilded)',
    country         STRING               COMMENT 'Two-letter country code',
    platform        STRING               COMMENT 'Device platform: ios, android',
    segment         STRING               COMMENT 'Spending segment: whale, dolphin, minnow, free',
    last_login      STRING               COMMENT 'ISO 8601 timestamp of most recent login',
    characters_owned INT                 COMMENT 'Total characters unlocked',
    legendary_heroes_owned INT           COMMENT 'Legendary-tier characters owned'
);

CREATE EXTERNAL TABLE gaming_analytics.user_acquisition (
    acquisition_id      STRING      NOT NULL,
    player_id           STRING      NOT NULL,
    install_date        STRING      NOT NULL,
    acquisition_channel STRING      NOT NULL COMMENT 'organic, paid_social, influencer, search, cross_promo',
    campaign_id         STRING               COMMENT 'FK to campaigns table (null for organic)',
    cost_per_install    DOUBLE               COMMENT 'CPI in USD',
    lifetime_value      DOUBLE               COMMENT 'Predicted or actual LTV in USD',
    retention_d1        BOOLEAN              COMMENT 'Returned on day 1 after install',
    retention_d7        BOOLEAN              COMMENT 'Returned on day 7 after install',
    retention_d30       BOOLEAN              COMMENT 'Returned on day 30 after install',
    first_purchase_date STRING               COMMENT 'Date of first purchase (null if free)',
    country             STRING,
    platform            STRING,
    FOREIGN KEY (player_id) REFERENCES gaming_analytics.players(player_id),
    FOREIGN KEY (campaign_id) REFERENCES gaming_analytics.campaigns(campaign_id)
);

CREATE EXTERNAL TABLE gaming_analytics.campaigns (
    campaign_id     STRING      NOT NULL,
    campaign_name   STRING      NOT NULL,
    campaign_type   STRING      NOT NULL COMMENT 'acquisition, retention, re-engagement',
    start_date      STRING      NOT NULL,
    end_date        STRING,
    budget          DOUBLE               COMMENT 'Total budget in USD',
    target_audience STRING               COMMENT 'Target player segment or demographic',
    channel         STRING               COMMENT 'Marketing channel: social_media, search, influencer',
    status          STRING      NOT NULL COMMENT 'active, completed, paused'
);
