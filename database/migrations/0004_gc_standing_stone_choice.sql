CREATE TABLE gc_standing_stone_choice (
  character_key text PRIMARY KEY,
  stone_key text NOT NULL,
  revision bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
