CREATE TABLE gc_spell_projection_heads (
  character_key text PRIMARY KEY,
  grant_set jsonb NOT NULL,
  complete boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE gc_spell_projections (
  character_key text NOT NULL,
  stable_form_key text NOT NULL,
  definition jsonb NOT NULL,
  revision jsonb NOT NULL,
  owned boolean NOT NULL,
  active boolean NOT NULL,
  PRIMARY KEY (character_key, stable_form_key)
);
