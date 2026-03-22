CREATE TABLE IF NOT EXISTS documents (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  content    TEXT        NOT NULL DEFAULT '',
  version    INTEGER     NOT NULL DEFAULT 0,
  owner_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- List a user's documents sorted by most recently updated
CREATE INDEX IF NOT EXISTS idx_documents_owner_id ON documents (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS document_permissions (
  id         SERIAL      PRIMARY KEY,
  doc_id     UUID        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  role       TEXT        NOT NULL CHECK (role IN ('editor', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (doc_id, user_id)  
);

CREATE INDEX IF NOT EXISTS idx_doc_permissions_user ON document_permissions (user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'documents_set_updated_at'
  ) THEN
    CREATE TRIGGER documents_set_updated_at
      BEFORE UPDATE ON documents
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;