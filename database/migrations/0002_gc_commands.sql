CREATE TABLE gc_commands (
  request_id text PRIMARY KEY,
  character_key text NOT NULL,
  command_type text NOT NULL,
  content_sha256 text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX gc_commands_character_idx ON gc_commands (character_key);
