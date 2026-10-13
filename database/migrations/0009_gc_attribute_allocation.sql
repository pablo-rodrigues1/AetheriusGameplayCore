-- Class owns allocation. Balance is derived from the transaction Leveling level.
-- The sole command writer validates multiples of 5 and nonnegative integers.
-- Reads reject invalid stored allocations; SQL policy intentionally excludes CHECK.
CREATE TABLE gc_attribute_allocation (
  character_key text PRIMARY KEY,
  health integer NOT NULL,
  magicka integer NOT NULL,
  stamina integer NOT NULL,
  revision bigint NOT NULL
);
