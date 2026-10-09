import type { Migration } from '../../../shared/persistence/src/index.js';
// Kept under runtime: B5b is not authorized to change database/ or shared/.
// Both the bundle and migration CLI include this immutable, additive migration.
export const perkMigration: Migration = {
  version: '0008_gc_perk_projection.sql',
  sql: `CREATE TABLE gc_perk_projections (
    character_key text NOT NULL,
    stable_form_key text NOT NULL,
    definition jsonb NOT NULL,
    revision jsonb NOT NULL,
    owned boolean NOT NULL,
    active boolean NOT NULL,
    item_status text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (character_key, stable_form_key)
  );`
};
