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
  IF OLD.locked_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- What must be immutable after the deadline is the USER'S PICK. `status` is
  -- system bookkeeping (LOCKED -> SCORED -> VOID) and must stay writable, or
  -- the scoring worker cannot record its own result.
  IF NEW.locked_at         IS DISTINCT FROM OLD.locked_at
  OR NEW.submitted_at      IS DISTINCT FROM OLD.submitted_at
  OR NEW.note              IS DISTINCT FROM OLD.note
  OR NEW.league_fixture_id IS DISTINCT FROM OLD.league_fixture_id
  OR NEW.user_id           IS DISTINCT FROM OLD.user_id
  OR NEW.booster_usage_id  IS DISTINCT FROM OLD.booster_usage_id
  THEN
    RAISE EXCEPTION 'prediction % is locked (locked_at=%) — its pick cannot be changed', OLD.id, OLD.locked_at
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
