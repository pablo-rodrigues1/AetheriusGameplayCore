-- No second event ledger: leveling event receipts use gc_commands.
CREATE TABLE gc_leveling_progress (
  character_key text PRIMARY KEY,
  total_xp numeric NOT NULL,
  character_level integer NOT NULL,
  progress jsonb NOT NULL,
  revision bigint NOT NULL
);
