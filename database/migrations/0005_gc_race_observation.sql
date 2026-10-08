-- Host-owned race, copied as an observation; no gameplay or host writer.
CREATE TABLE gc_race_observation (
  character_key text PRIMARY KEY,
  status text NOT NULL,
  race_key text,
  reason text,
  observed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revision bigint NOT NULL
);
