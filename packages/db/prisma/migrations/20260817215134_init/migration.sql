-- CreateEnum
CREATE TYPE "CompetitionType" AS ENUM ('LEAGUE', 'DOMESTIC_CUP', 'LEAGUE_CUP', 'SUPER_CUP', 'CONTINENTAL');

-- CreateEnum
CREATE TYPE "RoundType" AS ENUM ('REGULAR_SEASON', 'GROUP_STAGE', 'LEAGUE_PHASE', 'KNOCKOUT_PLAYOFF', 'ROUND_OF_16', 'QUARTER_FINAL', 'SEMI_FINAL', 'FINAL');

-- CreateEnum
CREATE TYPE "TieDecider" AS ENUM ('AGGREGATE', 'EXTRA_TIME', 'PENALTIES', 'AWARDED');

-- CreateEnum
CREATE TYPE "KnockoutScoreBasis" AS ENUM ('NINETY_MINUTES', 'AFTER_EXTRA_TIME', 'INCLUDING_PENALTIES');

-- CreateEnum
CREATE TYPE "FixtureStatus" AS ENUM ('SCHEDULED', 'DELAYED', 'LIVE', 'HALF_TIME', 'SECOND_HALF', 'EXTRA_TIME', 'PENALTY_SHOOTOUT', 'FINISHED', 'POSTPONED', 'ABANDONED', 'CANCELLED', 'AWARDED');

-- CreateEnum
CREATE TYPE "PositionGroup" AS ENUM ('GOALKEEPER', 'DEFENDER', 'MIDFIELDER', 'FORWARD');

-- CreateEnum
CREATE TYPE "PreferredFoot" AS ENUM ('LEFT', 'RIGHT', 'BOTH', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MatchEventType" AS ENUM ('GOAL', 'OWN_GOAL', 'PENALTY_SCORED', 'PENALTY_MISSED', 'ASSIST', 'YELLOW_CARD', 'SECOND_YELLOW', 'RED_CARD', 'SUBSTITUTION', 'VAR_DECISION', 'PENALTY_SHOOTOUT_SCORED', 'PENALTY_SHOOTOUT_MISSED');

-- CreateEnum
CREATE TYPE "MatchOutcome" AS ENUM ('HOME', 'DRAW', 'AWAY');

-- CreateEnum
CREATE TYPE "MarketType" AS ENUM ('EXACT_SCORE', 'MATCH_OUTCOME', 'DOUBLE_CHANCE', 'BOTH_TEAMS_TO_SCORE', 'TOTAL_GOALS_OVER_UNDER', 'CORRECT_MARGIN', 'HALF_TIME_OUTCOME', 'FIRST_GOALSCORER', 'ANYTIME_GOALSCORER', 'CLEAN_SHEET', 'RED_CARD_SHOWN', 'TOTAL_CORNERS_OVER_UNDER', 'TO_QUALIFY');

-- CreateEnum
CREATE TYPE "LeagueVisibility" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'INVITED', 'REQUESTED', 'LEFT', 'REMOVED', 'BANNED');

-- CreateEnum
CREATE TYPE "LeagueRoundStatus" AS ENUM ('UPCOMING', 'LOCKED', 'PROVISIONAL', 'FINAL', 'VOID');

-- CreateEnum
CREATE TYPE "PredictionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'LOCKED', 'SCORED', 'VOID', 'MISSED');

-- CreateEnum
CREATE TYPE "DeadlineStrategy" AS ENUM ('PER_FIXTURE_KICKOFF', 'ROUND_FIRST_KICKOFF', 'FIXED_DATETIME', 'CUSTOM_PER_ROUND');

-- CreateEnum
CREATE TYPE "BoosterType" AS ENUM ('DOUBLE_POINTS', 'TRIPLE_POINTS', 'BANKER', 'INSURANCE', 'WILDCARD_ROUND', 'NO_NEGATIVES');

-- CreateEnum
CREATE TYPE "ScoringRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "IngestJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "ExternalEntity" AS ENUM ('COMPETITION', 'SEASON', 'TEAM', 'PLAYER', 'FIXTURE', 'VENUE', 'ROUND', 'TIE');

-- CreateTable
CREATE TABLE "countries" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "iso_code" VARCHAR(3),
    "flag_url" TEXT,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitions" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT,
    "type" "CompetitionType" NOT NULL DEFAULT 'LEAGUE',
    "tier" INTEGER NOT NULL DEFAULT 1,
    "logo_url" TEXT,
    "country_id" TEXT,
    "confederation" TEXT,
    "is_supported" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" TEXT NOT NULL,
    "competition_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "start_year" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "total_rounds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rounds" (
    "id" TEXT NOT NULL,
    "season_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" "RoundType" NOT NULL DEFAULT 'REGULAR_SEASON',
    "group_name" TEXT,
    "is_two_legged" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "draw_at" TIMESTAMP(3),
    "is_schedule_final" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ties" (
    "id" TEXT NOT NULL,
    "season_id" TEXT NOT NULL,
    "round_id" TEXT NOT NULL,
    "team_a_id" TEXT NOT NULL,
    "team_b_id" TEXT NOT NULL,
    "aggregate_a" INTEGER,
    "aggregate_b" INTEGER,
    "winner_team_id" TEXT,
    "decided_by" "TieDecider",
    "settled_at" TIMESTAMP(3),
    "result_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venues" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "capacity" INTEGER,
    "surface" TEXT,
    "image_url" TEXT,

    CONSTRAINT "venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT,
    "tla" VARCHAR(4),
    "crest_url" TEXT,
    "primary_color" VARCHAR(9),
    "founded_year" INTEGER,
    "country_id" TEXT,
    "venue_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_seasons" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "season_id" TEXT NOT NULL,

    CONSTRAINT "team_seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "display_name" TEXT NOT NULL,
    "date_of_birth" DATE,
    "nationality_id" TEXT,
    "height_cm" INTEGER,
    "weight_kg" INTEGER,
    "position" "PositionGroup",
    "detailed_role" TEXT,
    "preferred_foot" "PreferredFoot" NOT NULL DEFAULT 'UNKNOWN',
    "photo_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_registrations" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "team_season_id" TEXT NOT NULL,
    "shirt_number" INTEGER,
    "on_loan" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" DATE,
    "left_at" DATE,

    CONSTRAINT "player_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixtures" (
    "id" TEXT NOT NULL,
    "season_id" TEXT NOT NULL,
    "round_id" TEXT,
    "tie_id" TEXT,
    "leg_number" INTEGER,
    "home_team_id" TEXT NOT NULL,
    "away_team_id" TEXT NOT NULL,
    "venue_id" TEXT,
    "kickoff_at" TIMESTAMP(3) NOT NULL,
    "status" "FixtureStatus" NOT NULL DEFAULT 'SCHEDULED',
    "minute" INTEGER,
    "injury_time" INTEGER,
    "home_goals" INTEGER,
    "away_goals" INTEGER,
    "home_goals_ht" INTEGER,
    "away_goals_ht" INTEGER,
    "home_goals_et" INTEGER,
    "away_goals_et" INTEGER,
    "home_penalties" INTEGER,
    "away_penalties" INTEGER,
    "outcome" "MatchOutcome",
    "result_version" INTEGER NOT NULL DEFAULT 0,
    "result_confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixtures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixture_events" (
    "id" TEXT NOT NULL,
    "fixture_id" TEXT NOT NULL,
    "team_id" TEXT,
    "player_id" TEXT,
    "related_player_id" TEXT,
    "type" "MatchEventType" NOT NULL,
    "minute" INTEGER NOT NULL,
    "extra_minute" INTEGER,
    "detail" TEXT,
    "sequence" INTEGER NOT NULL,

    CONSTRAINT "fixture_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_match_stats" (
    "id" TEXT NOT NULL,
    "fixture_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "is_home" BOOLEAN NOT NULL,
    "yellow_cards" INTEGER,
    "red_cards" INTEGER,
    "possession" DECIMAL(5,2),
    "shots" INTEGER,
    "shots_on_target" INTEGER,
    "corners" INTEGER,
    "fouls" INTEGER,
    "offsides" INTEGER,
    "expected_goals" DECIMAL(5,2),
    "passes" INTEGER,
    "pass_accuracy" DECIMAL(5,2),
    "saves" INTEGER,

    CONSTRAINT "team_match_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_match_stats" (
    "id" TEXT NOT NULL,
    "fixture_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "started" BOOLEAN NOT NULL DEFAULT false,
    "minutes_played" INTEGER NOT NULL DEFAULT 0,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "yellow_cards" INTEGER NOT NULL DEFAULT 0,
    "red_cards" INTEGER NOT NULL DEFAULT 0,
    "penalties_scored" INTEGER NOT NULL DEFAULT 0,
    "penalties_missed" INTEGER NOT NULL DEFAULT 0,
    "shots" INTEGER,
    "shots_on_target" INTEGER,
    "expected_goals" DECIMAL(5,2),
    "expected_assists" DECIMAL(5,2),
    "passes" INTEGER,
    "key_passes" INTEGER,
    "tackles" INTEGER,
    "interceptions" INTEGER,
    "duels_won" INTEGER,
    "dribbles_completed" INTEGER,
    "saves" INTEGER,
    "goals_conceded" INTEGER,
    "rating" DECIMAL(4,2),

    CONSTRAINT "player_match_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_season_stats" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "season_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "appearances" INTEGER NOT NULL DEFAULT 0,
    "starts" INTEGER NOT NULL DEFAULT 0,
    "minutes_played" INTEGER NOT NULL DEFAULT 0,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "expected_goals" DECIMAL(6,2),
    "expected_assists" DECIMAL(6,2),
    "shots" INTEGER NOT NULL DEFAULT 0,
    "shots_on_target" INTEGER NOT NULL DEFAULT 0,
    "yellow_cards" INTEGER NOT NULL DEFAULT 0,
    "red_cards" INTEGER NOT NULL DEFAULT 0,
    "clean_sheets" INTEGER NOT NULL DEFAULT 0,
    "goals_conceded" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "penalties_scored" INTEGER NOT NULL DEFAULT 0,
    "average_rating" DECIMAL(4,2),
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_season_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_season_stats" (
    "id" TEXT NOT NULL,
    "team_season_id" TEXT NOT NULL,
    "played" INTEGER NOT NULL DEFAULT 0,
    "won" INTEGER NOT NULL DEFAULT 0,
    "drawn" INTEGER NOT NULL DEFAULT 0,
    "lost" INTEGER NOT NULL DEFAULT 0,
    "goals_for" INTEGER NOT NULL DEFAULT 0,
    "goals_against" INTEGER NOT NULL DEFAULT 0,
    "clean_sheets" INTEGER NOT NULL DEFAULT 0,
    "failed_to_score" INTEGER NOT NULL DEFAULT 0,
    "expected_goals_for" DECIMAL(6,2),
    "expected_goals_against" DECIMAL(6,2),
    "avg_possession" DECIMAL(5,2),
    "yellow_cards" INTEGER NOT NULL DEFAULT 0,
    "red_cards" INTEGER NOT NULL DEFAULT 0,
    "form_last5" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_season_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standing_rows" (
    "id" TEXT NOT NULL,
    "season_id" TEXT NOT NULL,
    "round_id" TEXT,
    "team_id" TEXT NOT NULL,
    "group_name" TEXT,
    "position" INTEGER NOT NULL,
    "played" INTEGER NOT NULL DEFAULT 0,
    "won" INTEGER NOT NULL DEFAULT 0,
    "drawn" INTEGER NOT NULL DEFAULT 0,
    "lost" INTEGER NOT NULL DEFAULT 0,
    "goals_for" INTEGER NOT NULL DEFAULT 0,
    "goals_against" INTEGER NOT NULL DEFAULT 0,
    "goal_difference" INTEGER NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 0,
    "form" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_latest" BOOLEAN NOT NULL DEFAULT true,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "standing_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_refs" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "entity" "ExternalEntity" NOT NULL,
    "external_id" TEXT NOT NULL,
    "internal_id" TEXT NOT NULL,
    "payload" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest_jobs" (
    "id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "scope_key" TEXT,
    "status" "IngestJobStatus" NOT NULL DEFAULT 'QUEUED',
    "records_read" INTEGER NOT NULL DEFAULT 0,
    "records_written" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingest_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified_at" TIMESTAMP(3),
    "password_hash" TEXT,
    "username" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "favourite_team_id" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_identities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "user_agent" TEXT,
    "ip_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prediction_leagues" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "banner_url" TEXT,
    "owner_id" TEXT NOT NULL,
    "season_id" TEXT NOT NULL,
    "visibility" "LeagueVisibility" NOT NULL DEFAULT 'UNLISTED',
    "join_code" VARCHAR(12),
    "max_members" INTEGER,
    "join_cutoff_round" INTEGER,
    "late_join_policy" TEXT NOT NULL DEFAULT 'ZERO',
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prediction_leagues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_sets" (
    "id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'House rules',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_frozen" BOOLEAN NOT NULL DEFAULT false,
    "deadline_strategy" "DeadlineStrategy" NOT NULL DEFAULT 'ROUND_FIRST_KICKOFF',
    "deadline_offset_min" INTEGER NOT NULL DEFAULT 0,
    "allow_edits" BOOLEAN NOT NULL DEFAULT true,
    "reveal_picks_before_deadline" BOOLEAN NOT NULL DEFAULT false,
    "missed_prediction_points" INTEGER NOT NULL DEFAULT 0,
    "fixtures_per_round" INTEGER,
    "max_boosters_per_season" INTEGER NOT NULL DEFAULT 0,
    "knockout_score_basis" "KnockoutScoreBasis" NOT NULL DEFAULT 'NINETY_MINUTES',
    "void_postponed_fixtures" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT,

    CONSTRAINT "rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "league_memberships" (
    "id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "nickname" TEXT,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),
    "effective_from_round" INTEGER,

    CONSTRAINT "league_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "league_invites" (
    "id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "email" TEXT,
    "token" TEXT NOT NULL,
    "invited_by_id" TEXT NOT NULL,
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "league_rounds" (
    "id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "round_id" TEXT NOT NULL,
    "rule_set_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "LeagueRoundStatus" NOT NULL DEFAULT 'UPCOMING',
    "deadline_at" TIMESTAMP(3) NOT NULL,
    "is_provisional" BOOLEAN NOT NULL DEFAULT false,
    "points_multiplier" DECIMAL(4,2) NOT NULL DEFAULT 1.0,
    "locked_at" TIMESTAMP(3),
    "scored_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "league_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "league_fixtures" (
    "id" TEXT NOT NULL,
    "league_round_id" TEXT NOT NULL,
    "fixture_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "weight" DECIMAL(4,2) NOT NULL DEFAULT 1.0,
    "deadline_at" TIMESTAMP(3),
    "is_voided" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "league_fixtures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "predictions" (
    "id" TEXT NOT NULL,
    "league_fixture_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "PredictionStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "locked_at" TIMESTAMP(3),
    "booster_usage_id" TEXT,
    "note" VARCHAR(280),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prediction_selections" (
    "id" TEXT NOT NULL,
    "prediction_id" TEXT NOT NULL,
    "market" "MarketType" NOT NULL,
    "home_goals" INTEGER,
    "away_goals" INTEGER,
    "outcome" "MatchOutcome",
    "boolean_value" BOOLEAN,
    "numeric_value" DECIMAL(6,2),
    "over_selected" BOOLEAN,
    "player_id" TEXT,
    "team_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prediction_selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booster_usages" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "league_round_id" TEXT NOT NULL,
    "type" "BoosterType" NOT NULL,
    "resolved_value" DECIMAL(4,2) NOT NULL,
    "used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "booster_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoring_runs" (
    "id" TEXT NOT NULL,
    "league_round_id" TEXT NOT NULL,
    "rule_set_id" TEXT NOT NULL,
    "status" "ScoringRunStatus" NOT NULL DEFAULT 'QUEUED',
    "input_hash" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "predictions_scored" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scoring_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prediction_scores" (
    "id" TEXT NOT NULL,
    "prediction_id" TEXT NOT NULL,
    "rule_set_id" TEXT NOT NULL,
    "scoring_run_id" TEXT NOT NULL,
    "base_points" DECIMAL(8,2) NOT NULL,
    "multiplier" DECIMAL(6,3) NOT NULL DEFAULT 1.0,
    "points" DECIMAL(8,2) NOT NULL,
    "is_exact_score" BOOLEAN NOT NULL DEFAULT false,
    "is_outcome_correct" BOOLEAN NOT NULL DEFAULT false,
    "breakdown" JSONB NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prediction_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standing_entries" (
    "id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "league_round_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "round_points" DECIMAL(8,2) NOT NULL,
    "total_points" DECIMAL(10,2) NOT NULL,
    "position" INTEGER NOT NULL,
    "previous_position" INTEGER,
    "exact_scores" INTEGER NOT NULL DEFAULT 0,
    "correct_outcomes" INTEGER NOT NULL DEFAULT 0,
    "predictions_made" INTEGER NOT NULL DEFAULT 0,
    "current_streak" INTEGER NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "standing_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link_path" TEXT,
    "data" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "countries_name_key" ON "countries"("name");

-- CreateIndex
CREATE UNIQUE INDEX "countries_iso_code_key" ON "countries"("iso_code");

-- CreateIndex
CREATE UNIQUE INDEX "competitions_slug_key" ON "competitions"("slug");

-- CreateIndex
CREATE INDEX "competitions_country_id_idx" ON "competitions"("country_id");

-- CreateIndex
CREATE INDEX "competitions_is_supported_tier_idx" ON "competitions"("is_supported", "tier");

-- CreateIndex
CREATE INDEX "seasons_is_current_idx" ON "seasons"("is_current");

-- CreateIndex
CREATE UNIQUE INDEX "seasons_competition_id_start_year_key" ON "seasons"("competition_id", "start_year");

-- CreateIndex
CREATE INDEX "rounds_season_id_starts_at_idx" ON "rounds"("season_id", "starts_at");

-- CreateIndex
CREATE INDEX "rounds_season_id_type_idx" ON "rounds"("season_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "rounds_season_id_number_key" ON "rounds"("season_id", "number");

-- CreateIndex
CREATE INDEX "ties_season_id_idx" ON "ties"("season_id");

-- CreateIndex
CREATE INDEX "ties_winner_team_id_idx" ON "ties"("winner_team_id");

-- CreateIndex
CREATE UNIQUE INDEX "ties_round_id_team_a_id_team_b_id_key" ON "ties"("round_id", "team_a_id", "team_b_id");

-- CreateIndex
CREATE INDEX "venues_name_idx" ON "venues"("name");

-- CreateIndex
CREATE UNIQUE INDEX "teams_slug_key" ON "teams"("slug");

-- CreateIndex
CREATE INDEX "teams_name_idx" ON "teams"("name");

-- CreateIndex
CREATE INDEX "team_seasons_season_id_idx" ON "team_seasons"("season_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_seasons_team_id_season_id_key" ON "team_seasons"("team_id", "season_id");

-- CreateIndex
CREATE UNIQUE INDEX "players_slug_key" ON "players"("slug");

-- CreateIndex
CREATE INDEX "players_display_name_idx" ON "players"("display_name");

-- CreateIndex
CREATE INDEX "players_position_idx" ON "players"("position");

-- CreateIndex
CREATE INDEX "player_registrations_team_season_id_idx" ON "player_registrations"("team_season_id");

-- CreateIndex
CREATE INDEX "player_registrations_player_id_idx" ON "player_registrations"("player_id");

-- CreateIndex
CREATE UNIQUE INDEX "player_registrations_player_id_team_season_id_joined_at_key" ON "player_registrations"("player_id", "team_season_id", "joined_at");

-- CreateIndex
CREATE INDEX "fixtures_season_id_kickoff_at_idx" ON "fixtures"("season_id", "kickoff_at");

-- CreateIndex
CREATE INDEX "fixtures_round_id_idx" ON "fixtures"("round_id");

-- CreateIndex
CREATE INDEX "fixtures_status_kickoff_at_idx" ON "fixtures"("status", "kickoff_at");

-- CreateIndex
CREATE INDEX "fixtures_home_team_id_idx" ON "fixtures"("home_team_id");

-- CreateIndex
CREATE INDEX "fixtures_away_team_id_idx" ON "fixtures"("away_team_id");

-- CreateIndex
CREATE UNIQUE INDEX "fixtures_tie_id_leg_number_key" ON "fixtures"("tie_id", "leg_number");

-- CreateIndex
CREATE INDEX "fixture_events_fixture_id_type_idx" ON "fixture_events"("fixture_id", "type");

-- CreateIndex
CREATE INDEX "fixture_events_player_id_type_idx" ON "fixture_events"("player_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "fixture_events_fixture_id_sequence_key" ON "fixture_events"("fixture_id", "sequence");

-- CreateIndex
CREATE INDEX "team_match_stats_team_id_idx" ON "team_match_stats"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_match_stats_fixture_id_team_id_key" ON "team_match_stats"("fixture_id", "team_id");

-- CreateIndex
CREATE INDEX "player_match_stats_player_id_idx" ON "player_match_stats"("player_id");

-- CreateIndex
CREATE INDEX "player_match_stats_team_id_idx" ON "player_match_stats"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "player_match_stats_fixture_id_player_id_key" ON "player_match_stats"("fixture_id", "player_id");

-- CreateIndex
CREATE INDEX "player_season_stats_season_id_goals_idx" ON "player_season_stats"("season_id", "goals" DESC);

-- CreateIndex
CREATE INDEX "player_season_stats_season_id_assists_idx" ON "player_season_stats"("season_id", "assists" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "player_season_stats_player_id_season_id_team_id_key" ON "player_season_stats"("player_id", "season_id", "team_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_season_stats_team_season_id_key" ON "team_season_stats"("team_season_id");

-- CreateIndex
CREATE INDEX "standing_rows_season_id_is_latest_position_idx" ON "standing_rows"("season_id", "is_latest", "position");

-- CreateIndex
CREATE UNIQUE INDEX "standing_rows_season_id_round_id_team_id_key" ON "standing_rows"("season_id", "round_id", "team_id");

-- CreateIndex
CREATE INDEX "external_refs_entity_internal_id_idx" ON "external_refs"("entity", "internal_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_refs_provider_entity_external_id_key" ON "external_refs"("provider", "entity", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_refs_provider_entity_internal_id_key" ON "external_refs"("provider", "entity", "internal_id");

-- CreateIndex
CREATE INDEX "ingest_jobs_job_type_status_created_at_idx" ON "ingest_jobs"("job_type", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE INDEX "auth_identities_user_id_idx" ON "auth_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_provider_provider_user_id_key" ON "auth_identities"("provider", "provider_user_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "prediction_leagues_slug_key" ON "prediction_leagues"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "prediction_leagues_join_code_key" ON "prediction_leagues"("join_code");

-- CreateIndex
CREATE INDEX "prediction_leagues_season_id_visibility_is_archived_idx" ON "prediction_leagues"("season_id", "visibility", "is_archived");

-- CreateIndex
CREATE INDEX "prediction_leagues_owner_id_idx" ON "prediction_leagues"("owner_id");

-- CreateIndex
CREATE INDEX "rule_sets_league_id_is_active_idx" ON "rule_sets"("league_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "rule_sets_league_id_version_key" ON "rule_sets"("league_id", "version");

-- CreateIndex
CREATE INDEX "league_memberships_user_id_status_idx" ON "league_memberships"("user_id", "status");

-- CreateIndex
CREATE INDEX "league_memberships_league_id_status_idx" ON "league_memberships"("league_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "league_memberships_league_id_user_id_key" ON "league_memberships"("league_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "league_invites_token_key" ON "league_invites"("token");

-- CreateIndex
CREATE INDEX "league_invites_league_id_idx" ON "league_invites"("league_id");

-- CreateIndex
CREATE INDEX "league_invites_expires_at_idx" ON "league_invites"("expires_at");

-- CreateIndex
CREATE INDEX "league_rounds_status_deadline_at_idx" ON "league_rounds"("status", "deadline_at");

-- CreateIndex
CREATE UNIQUE INDEX "league_rounds_league_id_round_id_key" ON "league_rounds"("league_id", "round_id");

-- CreateIndex
CREATE UNIQUE INDEX "league_rounds_league_id_sequence_key" ON "league_rounds"("league_id", "sequence");

-- CreateIndex
CREATE INDEX "league_fixtures_fixture_id_idx" ON "league_fixtures"("fixture_id");

-- CreateIndex
CREATE UNIQUE INDEX "league_fixtures_league_round_id_fixture_id_key" ON "league_fixtures"("league_round_id", "fixture_id");

-- CreateIndex
CREATE UNIQUE INDEX "predictions_booster_usage_id_key" ON "predictions"("booster_usage_id");

-- CreateIndex
CREATE INDEX "predictions_user_id_status_idx" ON "predictions"("user_id", "status");

-- CreateIndex
CREATE INDEX "predictions_league_fixture_id_idx" ON "predictions"("league_fixture_id");

-- CreateIndex
CREATE UNIQUE INDEX "predictions_league_fixture_id_user_id_key" ON "predictions"("league_fixture_id", "user_id");

-- CreateIndex
CREATE INDEX "prediction_selections_player_id_idx" ON "prediction_selections"("player_id");

-- CreateIndex
CREATE UNIQUE INDEX "prediction_selections_prediction_id_market_key" ON "prediction_selections"("prediction_id", "market");

-- CreateIndex
CREATE INDEX "booster_usages_league_round_id_idx" ON "booster_usages"("league_round_id");

-- CreateIndex
CREATE UNIQUE INDEX "booster_usages_user_id_league_round_id_type_key" ON "booster_usages"("user_id", "league_round_id", "type");

-- CreateIndex
CREATE INDEX "scoring_runs_status_created_at_idx" ON "scoring_runs"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "scoring_runs_league_round_id_input_hash_key" ON "scoring_runs"("league_round_id", "input_hash");

-- CreateIndex
CREATE UNIQUE INDEX "prediction_scores_prediction_id_key" ON "prediction_scores"("prediction_id");

-- CreateIndex
CREATE INDEX "prediction_scores_scoring_run_id_idx" ON "prediction_scores"("scoring_run_id");

-- CreateIndex
CREATE INDEX "standing_entries_league_id_league_round_id_position_idx" ON "standing_entries"("league_id", "league_round_id", "position");

-- CreateIndex
CREATE INDEX "standing_entries_user_id_idx" ON "standing_entries"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "standing_entries_league_round_id_user_id_key" ON "standing_entries"("league_round_id", "user_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- AddForeignKey
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "competitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ties" ADD CONSTRAINT "ties_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ties" ADD CONSTRAINT "ties_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ties" ADD CONSTRAINT "ties_team_a_id_fkey" FOREIGN KEY ("team_a_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ties" ADD CONSTRAINT "ties_team_b_id_fkey" FOREIGN KEY ("team_b_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ties" ADD CONSTRAINT "ties_winner_team_id_fkey" FOREIGN KEY ("winner_team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_seasons" ADD CONSTRAINT "team_seasons_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_seasons" ADD CONSTRAINT "team_seasons_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_nationality_id_fkey" FOREIGN KEY ("nationality_id") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_registrations" ADD CONSTRAINT "player_registrations_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_registrations" ADD CONSTRAINT "player_registrations_team_season_id_fkey" FOREIGN KEY ("team_season_id") REFERENCES "team_seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_tie_id_fkey" FOREIGN KEY ("tie_id") REFERENCES "ties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_home_team_id_fkey" FOREIGN KEY ("home_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_away_team_id_fkey" FOREIGN KEY ("away_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixture_events" ADD CONSTRAINT "fixture_events_fixture_id_fkey" FOREIGN KEY ("fixture_id") REFERENCES "fixtures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixture_events" ADD CONSTRAINT "fixture_events_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixture_events" ADD CONSTRAINT "fixture_events_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixture_events" ADD CONSTRAINT "fixture_events_related_player_id_fkey" FOREIGN KEY ("related_player_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_match_stats" ADD CONSTRAINT "team_match_stats_fixture_id_fkey" FOREIGN KEY ("fixture_id") REFERENCES "fixtures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_match_stats" ADD CONSTRAINT "team_match_stats_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_fixture_id_fkey" FOREIGN KEY ("fixture_id") REFERENCES "fixtures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_season_stats" ADD CONSTRAINT "player_season_stats_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_season_stats" ADD CONSTRAINT "player_season_stats_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_season_stats" ADD CONSTRAINT "player_season_stats_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_season_stats" ADD CONSTRAINT "team_season_stats_team_season_id_fkey" FOREIGN KEY ("team_season_id") REFERENCES "team_seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standing_rows" ADD CONSTRAINT "standing_rows_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standing_rows" ADD CONSTRAINT "standing_rows_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standing_rows" ADD CONSTRAINT "standing_rows_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_leagues" ADD CONSTRAINT "prediction_leagues_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_leagues" ADD CONSTRAINT "prediction_leagues_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_sets" ADD CONSTRAINT "rule_sets_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "prediction_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_memberships" ADD CONSTRAINT "league_memberships_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "prediction_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_memberships" ADD CONSTRAINT "league_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_invites" ADD CONSTRAINT "league_invites_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "prediction_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_rounds" ADD CONSTRAINT "league_rounds_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "prediction_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_rounds" ADD CONSTRAINT "league_rounds_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_rounds" ADD CONSTRAINT "league_rounds_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "rule_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_fixtures" ADD CONSTRAINT "league_fixtures_league_round_id_fkey" FOREIGN KEY ("league_round_id") REFERENCES "league_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_fixtures" ADD CONSTRAINT "league_fixtures_fixture_id_fkey" FOREIGN KEY ("fixture_id") REFERENCES "fixtures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_league_fixture_id_fkey" FOREIGN KEY ("league_fixture_id") REFERENCES "league_fixtures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_booster_usage_id_fkey" FOREIGN KEY ("booster_usage_id") REFERENCES "booster_usages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_selections" ADD CONSTRAINT "prediction_selections_prediction_id_fkey" FOREIGN KEY ("prediction_id") REFERENCES "predictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_selections" ADD CONSTRAINT "prediction_selections_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_selections" ADD CONSTRAINT "prediction_selections_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booster_usages" ADD CONSTRAINT "booster_usages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booster_usages" ADD CONSTRAINT "booster_usages_league_round_id_fkey" FOREIGN KEY ("league_round_id") REFERENCES "league_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_runs" ADD CONSTRAINT "scoring_runs_league_round_id_fkey" FOREIGN KEY ("league_round_id") REFERENCES "league_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_runs" ADD CONSTRAINT "scoring_runs_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "rule_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_scores" ADD CONSTRAINT "prediction_scores_prediction_id_fkey" FOREIGN KEY ("prediction_id") REFERENCES "predictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_scores" ADD CONSTRAINT "prediction_scores_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "rule_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_scores" ADD CONSTRAINT "prediction_scores_scoring_run_id_fkey" FOREIGN KEY ("scoring_run_id") REFERENCES "scoring_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standing_entries" ADD CONSTRAINT "standing_entries_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "prediction_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standing_entries" ADD CONSTRAINT "standing_entries_league_round_id_fkey" FOREIGN KEY ("league_round_id") REFERENCES "league_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standing_entries" ADD CONSTRAINT "standing_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════
-- Appended from prisma/sql/001_constraints_and_triggers.sql (task P0-13).
-- Constraints, partial indexes and triggers Prisma cannot express.
-- ═══════════════════════════════════════════════════════════════════

-- WherePreds — constraints, partial indexes and triggers that Prisma's schema
-- language cannot express. Spec: docs/architecture.md §7.2, task P0-13.
--
-- HOW THIS IS APPLIED
--   Once a Neon database exists (P0-06), run:
--       pnpm db:migrate --name init
--   then APPEND the contents of this file to the generated migration in
--   packages/db/prisma/migrations/<timestamp>_init/migration.sql, and re-run
--   `pnpm db:migrate` so the checksum is recorded.
--
--   Every statement is idempotent, so applying it twice is harmless and it can
--   also be run directly against a database that already has the tables.
--
-- WHY IT MATTERS
--   The locked-prediction trigger is the second line of defence on the one
--   thing this product cannot get wrong: nobody may edit a prediction after
--   the deadline. The service layer already refuses late writes (§10.2); this
--   guarantees no future code path — including an admin script written in a
--   hurry — can bypass it.

-- ─────────────────────────────────────────────────────────────────────────────
-- Fuzzy search for the goalscorer and team pickers (P1-20).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS players_display_name_trgm
  ON players USING gin (display_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS teams_name_trgm
  ON teams USING gin (name gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────────────────────
-- Partial unique indexes. Prisma cannot express a WHERE clause on @@unique.
-- ─────────────────────────────────────────────────────────────────────────────

-- Exactly one active rule set per league, enforced by the database rather than
-- by convention. Two active versions would make scoring non-deterministic.
CREATE UNIQUE INDEX IF NOT EXISTS rule_sets_one_active
  ON rule_sets (league_id) WHERE is_active;

-- One current season per competition.
CREATE UNIQUE INDEX IF NOT EXISTS seasons_one_current
  ON seasons (competition_id) WHERE is_current;

-- The live league table is exactly one row per team.
CREATE UNIQUE INDEX IF NOT EXISTS standing_rows_latest
  ON standing_rows (season_id, team_id) WHERE is_latest;

-- ─────────────────────────────────────────────────────────────────────────────
-- Knockout integrity (§5.2, P1b-04).
-- ─────────────────────────────────────────────────────────────────────────────

-- A tie's winner must be one of its two participants.
ALTER TABLE ties DROP CONSTRAINT IF EXISTS ties_winner_is_participant;
ALTER TABLE ties ADD CONSTRAINT ties_winner_is_participant
  CHECK (winner_team_id IS NULL
         OR winner_team_id = team_a_id
         OR winner_team_id = team_b_id);

-- A tie is between two DIFFERENT clubs.
ALTER TABLE ties DROP CONSTRAINT IF EXISTS ties_distinct_participants;
ALTER TABLE ties ADD CONSTRAINT ties_distinct_participants
  CHECK (team_a_id <> team_b_id);

-- A knockout leg declares which leg it is, and a league match declares neither.
ALTER TABLE fixtures DROP CONSTRAINT IF EXISTS fixtures_tie_leg_paired;
ALTER TABLE fixtures ADD CONSTRAINT fixtures_tie_leg_paired
  CHECK ((tie_id IS NULL AND leg_number IS NULL)
      OR (tie_id IS NOT NULL AND leg_number IN (1, 2)));

-- A fixture is between two different clubs.
ALTER TABLE fixtures DROP CONSTRAINT IF EXISTS fixtures_distinct_teams;
ALTER TABLE fixtures ADD CONSTRAINT fixtures_distinct_teams
  CHECK (home_team_id <> away_team_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Prediction integrity — the product's core promise (§10.2).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION guard_locked_prediction() RETURNS trigger AS $$
BEGIN
  -- Once locked_at is set it may never change, and neither may the prediction
  -- it protects. Clearing locked_at is also refused: unlocking a prediction is
  -- indistinguishable from cheating.
  IF OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'prediction % is locked (locked_at=%)', OLD.id, OLD.locked_at
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS predictions_locked_guard ON predictions;
CREATE TRIGGER predictions_locked_guard
  BEFORE UPDATE ON predictions
  FOR EACH ROW
  -- Only fires when the row was already locked. The locking job itself sets
  -- locked_at on a row where it was NULL, so it passes through untouched.
  WHEN (OLD.locked_at IS NOT NULL)
  EXECUTE FUNCTION guard_locked_prediction();

-- Selections belong to a prediction; block edits once the parent is locked.
CREATE OR REPLACE FUNCTION guard_locked_selection() RETURNS trigger AS $$
DECLARE
  parent_locked TIMESTAMP;
BEGIN
  SELECT locked_at INTO parent_locked
    FROM predictions WHERE id = COALESCE(NEW.prediction_id, OLD.prediction_id);

  IF parent_locked IS NOT NULL THEN
    RAISE EXCEPTION 'prediction % is locked; its selections are immutable',
      COALESCE(NEW.prediction_id, OLD.prediction_id)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prediction_selections_locked_guard ON prediction_selections;
CREATE TRIGGER prediction_selections_locked_guard
  BEFORE INSERT OR UPDATE OR DELETE ON prediction_selections
  FOR EACH ROW
  EXECUTE FUNCTION guard_locked_selection();

-- A prediction can never be submitted after it was locked.
ALTER TABLE predictions DROP CONSTRAINT IF EXISTS predictions_submitted_before_locked;
ALTER TABLE predictions ADD CONSTRAINT predictions_submitted_before_locked
  CHECK (submitted_at IS NULL OR locked_at IS NULL OR submitted_at <= locked_at);
