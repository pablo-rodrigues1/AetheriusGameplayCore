-- Class owns only the choice. XP and level are owned by Leveling.
CREATE TABLE gc_character_class (
  character_key text PRIMARY KEY,
  class_id text NOT NULL,
  revision bigint NOT NULL
);
