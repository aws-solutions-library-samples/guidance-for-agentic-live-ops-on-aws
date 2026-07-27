-- Gaming Analytics — Combat, Social & Guild Tables
-- Source: AWS Glue / Athena (gaming_analytics database)

CREATE EXTERNAL TABLE gaming_analytics.arena_battles (
    battle_id               STRING      NOT NULL,
    player_id               STRING      NOT NULL,
    battle_type             STRING      NOT NULL COMMENT 'squad_arena, fleet_arena',
    battle_timestamp        STRING      NOT NULL,
    opponent_player_id      STRING      NOT NULL,
    player_rank_before      INT,
    player_rank_after       INT,
    battle_result           STRING      NOT NULL COMMENT 'win, loss, draw',
    team_power_used         BIGINT,
    opponent_team_power     BIGINT,
    battle_duration_seconds INT,
    crystals_earned         INT,
    arena_tokens_earned     INT,
    characters_used         STRING               COMMENT 'Comma-separated character names',
    strategy_effectiveness  DOUBLE               COMMENT 'Effectiveness score 0.0-1.0',
    FOREIGN KEY (player_id) REFERENCES gaming_analytics.players(player_id),
    FOREIGN KEY (opponent_player_id) REFERENCES gaming_analytics.players(player_id)
);

CREATE EXTERNAL TABLE gaming_analytics.character_interactions (
    interaction_id          STRING      NOT NULL,
    player_id               STRING      NOT NULL,
    character_name          STRING      NOT NULL,
    interaction_type        STRING      NOT NULL COMMENT 'level_up, gear_equip, star_promote, relic_upgrade',
    interaction_timestamp   STRING      NOT NULL,
    level_before            INT,
    level_after             INT,
    power_before            BIGINT,
    power_after             BIGINT,
    star_level_before       INT                  COMMENT 'Star rating 1-7',
    star_level_after        INT                  COMMENT 'Star rating 1-7',
    relic_level_before      INT,
    relic_level_after       INT,
    gear_pieces_applied     INT,
    credits_spent           BIGINT,
    materials_used          INT,
    FOREIGN KEY (player_id) REFERENCES gaming_analytics.players(player_id)
);

CREATE EXTERNAL TABLE gaming_analytics.guild_activities (
    activity_id                     STRING      NOT NULL,
    player_id                       STRING      NOT NULL,
    guild_id                        STRING      NOT NULL,
    activity_type                   STRING      NOT NULL COMMENT 'raid, territory_battle, territory_war, donation',
    activity_timestamp              STRING      NOT NULL,
    contribution_score              INT,
    damage_dealt                    BIGINT,
    energy_donated                  INT,
    guild_tokens_earned             INT,
    participation_rank              INT,
    raid_tier                       STRING               COMMENT 'heroic, normal',
    territory_battles_participated  INT,
    territory_war_battles           INT,
    FOREIGN KEY (player_id) REFERENCES gaming_analytics.players(player_id)
);

CREATE EXTERNAL TABLE gaming_analytics.social_interactions (
    interaction_id      STRING      NOT NULL,
    player_id           STRING      NOT NULL,
    target_player_id    STRING      NOT NULL,
    interaction_type    STRING      NOT NULL COMMENT 'chat_message, friend_request, guild_invite, gift',
    interaction_date    STRING      NOT NULL,
    message_length      INT,
    sentiment           STRING               COMMENT 'positive, neutral, negative',
    response_received   BOOLEAN,
    guild_context       BOOLEAN              COMMENT 'Whether interaction occurred within guild',
    influence_score     DOUBLE               COMMENT 'Social influence metric 0.0-1.0',
    FOREIGN KEY (player_id) REFERENCES gaming_analytics.players(player_id),
    FOREIGN KEY (target_player_id) REFERENCES gaming_analytics.players(player_id)
);
