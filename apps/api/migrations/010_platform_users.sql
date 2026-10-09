-- Platform console principals (SlotWise admins / developers).
-- Intentionally separate from tenant `users` (owner|staff).

CREATE TABLE platform_users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',  -- admin | developer
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT platform_users_role CHECK (role IN ('admin', 'developer')),
  UNIQUE (email)
);

CREATE INDEX platform_users_email_idx ON platform_users (email);

CREATE TABLE platform_refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (token_hash)
);

CREATE INDEX platform_refresh_tokens_user_idx ON platform_refresh_tokens (user_id);
