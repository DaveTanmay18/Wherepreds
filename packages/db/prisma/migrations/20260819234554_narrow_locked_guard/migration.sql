-- Narrow the locked-prediction guard (architecture.md §10.2).
--
-- The original trigger refused EVERY update to a locked prediction. That is
-- stricter than the guarantee actually needed, and it blocked the scoring
-- worker from marking predictions SCORED — caught by the Phase 3 pipeline
-- test before it could reach production.
--
-- What must be immutable after the deadline is the USER'S PICK: the fixture,
-- the owner, the note, the submission time, the booster nomination, and
-- locked_at itself. `status` is system bookkeeping (LOCKED -> SCORED -> VOID)
-- and must remain writable, or scoring cannot record its own result.
--
-- The selections trigger is unchanged: those ARE the pick, and nothing may
-- touch them once locked.

CREATE OR REPLACE FUNCTION guard_locked_prediction() RETURNS trigger AS $$
BEGIN
  IF OLD.locked_at IS NULL THEN
    RETURN NEW;
  END IF;

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
