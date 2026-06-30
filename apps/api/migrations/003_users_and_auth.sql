-- Users are dashboard login accounts (owners/admins of a business).
-- This is intentionally separate from `staff`, which represents bookable
-- resources (a hairdresser, a doctor) — a staff member may or may not have
-- a login, and a login (e.g. a manager) may not be a bookable staff member.

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'owner',  -- owner | staff
  staff_id      UUID REFERENCES staff(id),       -- optional link if this user is also a bookable staff member
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT users_role CHECK (role IN ('owner', 'staff')),
  UNIQUE(email) -- email is globally unique across all tenants (login identifier)
);

CREATE INDEX users_business_idx ON users(business_id);
CREATE INDEX users_email_idx ON users(email);

-- Refresh tokens — long-lived, revocable, rotated on use.
-- Access tokens (short-lived JWTs) are never stored; refresh tokens are,
-- so a logout or "log out everywhere" can actually invalidate sessions.

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,        -- SHA-256 of the actual token, never store raw
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(token_hash)
);

CREATE INDEX refresh_tokens_user_idx ON refresh_tokens(user_id);
CREATE INDEX refresh_tokens_lookup_idx ON refresh_tokens(token_hash) WHERE revoked_at IS NULL;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
