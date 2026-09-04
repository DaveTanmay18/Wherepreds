-- Two deletion bugs, both surfaced by the Phase 3 pipeline test's teardown.
--
-- 1. RuleSet was referenced with the default RESTRICT from scoring_runs,
--    prediction_scores and league_rounds. Once a league had been scored it
--    became undeletable: the league cascade reaches rule_sets, and the
--    restricted children block it. Protection against dropping a live rule set
--    comes from `is_frozen` and the versioning rules (§8.7), not from an FK
--    that makes league deletion impossible.
--
-- 2. The selections guard fired on DELETE, which broke the very cascade that
--    removes a league. Deleting league -> league_fixtures -> predictions
--    cascades into prediction_selections while the parent prediction row still
--    exists, so the guard saw a locked parent and refused. The guard now
--    covers INSERT and UPDATE only: those are the paths that could alter a
--    pick. Removal still requires deleting the prediction itself, which the
--    prediction-level guard and the service layer both protect.

ALTER TABLE "scoring_runs" DROP CONSTRAINT "scoring_runs_rule_set_id_fkey";
ALTER TABLE "scoring_runs" ADD CONSTRAINT "scoring_runs_rule_set_id_fkey"
  FOREIGN KEY ("rule_set_id") REFERENCES "rule_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "prediction_scores" DROP CONSTRAINT "prediction_scores_rule_set_id_fkey";
ALTER TABLE "prediction_scores" ADD CONSTRAINT "prediction_scores_rule_set_id_fkey"
  FOREIGN KEY ("rule_set_id") REFERENCES "rule_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "league_rounds" DROP CONSTRAINT "league_rounds_rule_set_id_fkey";
ALTER TABLE "league_rounds" ADD CONSTRAINT "league_rounds_rule_set_id_fkey"
  FOREIGN KEY ("rule_set_id") REFERENCES "rule_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TRIGGER IF EXISTS prediction_selections_locked_guard ON prediction_selections;
CREATE TRIGGER prediction_selections_locked_guard
  BEFORE INSERT OR UPDATE ON prediction_selections
  FOR EACH ROW
  EXECUTE FUNCTION guard_locked_selection();
