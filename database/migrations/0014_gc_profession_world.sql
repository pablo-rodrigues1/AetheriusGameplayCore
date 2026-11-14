CREATE TABLE gc_profession_world_sequences (
  character_id uuid PRIMARY KEY,
  sequence bigint NOT NULL DEFAULT 0
);
CREATE TABLE gc_profession_world_sites (
  site_key text PRIMARY KEY,
  signature text NOT NULL,
  capacity integer NOT NULL,
  remaining integer NOT NULL,
  generation bigint NOT NULL DEFAULT 0,
  available_at_ms bigint NOT NULL DEFAULT 0
);
CREATE TABLE gc_profession_world_leases (
  operation_id uuid PRIMARY KEY,
  character_id uuid NOT NULL,
  site_key text NOT NULL REFERENCES gc_profession_world_sites (site_key),
  expires_at_ms bigint NOT NULL
);
CREATE INDEX gc_profession_world_leases_site_idx ON gc_profession_world_leases (site_key, expires_at_ms);
CREATE TABLE gc_profession_world_operations (
  operation_id uuid PRIMARY KEY,
  character_id uuid NOT NULL,
  sequence bigint NOT NULL,
  status text NOT NULL,
  binding jsonb NOT NULL,
  before_inventory jsonb NOT NULL,
  after_inventory jsonb NOT NULL,
  items jsonb NOT NULL,
  native_receipt jsonb NOT NULL,
  receipt jsonb NOT NULL,
  digest text NOT NULL,
  site_key text NULL,
  site_generation bigint NULL,
  created_at_ms bigint NOT NULL,
  UNIQUE (character_id, sequence)
);
CREATE INDEX gc_profession_world_operations_character_idx ON gc_profession_world_operations (character_id, sequence);
CREATE INDEX gc_profession_world_operations_status_idx ON gc_profession_world_operations (status, created_at_ms);
