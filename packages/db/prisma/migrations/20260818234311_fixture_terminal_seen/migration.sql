-- Result confirmation guard (architecture.md §11.4, task P1-12).
-- Two consecutive terminal polls are required before a fixture is FINISHED.
ALTER TABLE "fixtures" ADD COLUMN "terminal_seen_at" TIMESTAMP(3);
