CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL CHECK (char_length(name) BETWEEN 2 AND 50),
  email      TEXT        NOT NULL,
  password   TEXT        NOT NULL,                
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique index on lowercase email — prevents duplicate accounts
CREATE UNIQUE INDEX idx_users_email ON users (lower(email));


CREATE TABLE refresh_tokens (
  id         SERIAL      PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup by token value — called on every /refresh and /logout
CREATE INDEX idx_refresh_tokens_token   ON refresh_tokens (token);

-- Fast lookup by user — called when logging out all devices
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens (user_id);

-- ── Auto-update updated_at ────────────────────────────────────────────────────
-- Postgres doesn't update timestamps automatically — we use a trigger.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();