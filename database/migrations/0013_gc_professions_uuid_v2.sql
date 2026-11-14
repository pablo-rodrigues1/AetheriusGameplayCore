-- Additive profession schema. Application adapters validate enums and numeric ranges.
CREATE TABLE gc_profession_state_v2 (
  character_id uuid PRIMARY KEY,
  profession_id text NULL,
  career_status text NULL,
  xp_milli bigint NOT NULL DEFAULT 0,
  profession_rank text NOT NULL,
  vigor_milli bigint NOT NULL,
  last_activity_at_ms bigint NOT NULL,
  revision bigint NOT NULL DEFAULT 0,
  config_version text NOT NULL,
  pending_operation_id uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE gc_profession_operations_v2 (
  operation_id uuid PRIMARY KEY,
  character_id uuid NOT NULL REFERENCES gc_profession_state_v2 (character_id),
  identity_epoch text NOT NULL,
  intention_sha256 text NOT NULL,
  status text NOT NULL,
  profession_id text NOT NULL,
  effective_rank text NOT NULL,
  activity_rank text NOT NULL,
  source_system text NOT NULL,
  definition_id text NOT NULL,
  definition_revision text NOT NULL,
  compatibility_signature text NOT NULL,
  vigor_cost_milli bigint NOT NULL,
  vigor_available_milli bigint NOT NULL,
  expected_xp_milli bigint NOT NULL,
  progression_revision bigint NOT NULL,
  config_version text NOT NULL,
  post_settlement_rank text NOT NULL,
  promotion_blocked_reason text NULL,
  fallback_rank text NOT NULL,
  result_ref text NULL,
  executor_receipt_id text NULL,
  receipt_digest text NULL,
  terminal_result jsonb NULL,
  last_error_code text NULL,
  created_at_ms bigint NOT NULL,
  settled_at_ms bigint NULL,
  cancelled_at_ms bigint NULL
);
CREATE INDEX gc_profession_operations_v2_character_idx ON gc_profession_operations_v2 (character_id, created_at_ms);
CREATE INDEX gc_profession_operations_v2_pending_idx ON gc_profession_operations_v2 (character_id, status);

CREATE TABLE gc_profession_outbox_v2 (
  event_id text PRIMARY KEY,
  character_id uuid NOT NULL,
  revision bigint NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  claimed_by text NULL,
  claimed_until_ms bigint NULL,
  delivered_at_ms bigint NULL,
  last_error_code text NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (character_id, revision, event_type)
);
CREATE INDEX gc_profession_outbox_v2_pending_idx ON gc_profession_outbox_v2 (revision, event_id);

CREATE TABLE gc_profession_admin_audit_v2 (
  request_id text PRIMARY KEY,
  actor_id text NOT NULL,
  target_character_id uuid NOT NULL,
  permission text NOT NULL,
  reason text NOT NULL,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  config_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX gc_profession_admin_audit_v2_target_idx ON gc_profession_admin_audit_v2 (target_character_id, created_at);
