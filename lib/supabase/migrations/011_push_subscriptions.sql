-- ── 011_push_subscriptions.sql ───────────────────────────────────────────────
-- Clean, isolated migration for Phase 1 push subscriptions.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint        TEXT NOT NULL UNIQUE,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  device_metadata JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Drop policy if it exists to allow re-runs
DROP POLICY IF EXISTS "users can manage their own subscriptions" ON push_subscriptions;

-- Policy: users can manage their own subscriptions
CREATE POLICY "users can manage their own subscriptions"
  ON push_subscriptions FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Indexes for optimal lookup performance
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

-- Update timestamp trigger
DROP TRIGGER IF EXISTS trg_push_subscriptions_updated_at ON push_subscriptions;
CREATE TRIGGER trg_push_subscriptions_updated_at
  BEFORE UPDATE ON push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_timestamp();
