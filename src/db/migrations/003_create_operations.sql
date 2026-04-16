CREATE TABLE IF NOT EXISTS operations (
  id         SERIAL      PRIMARY KEY,
  doc_id     UUID        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version    INTEGER     NOT NULL,
  op         JSONB       NOT NULL,   -- { type, id, afterId?, char? }
  user_id    UUID        NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (doc_id, version)
);

-- Fast range query: "give me all ops for doc X since version N"
-- Used on every reconnect catch-up and every OT transform step.
CREATE INDEX IF NOT EXISTS idx_operations_doc_version ON operations (doc_id, version ASC);

-- Fast lookup by user — useful for history and audit views
CREATE INDEX IF NOT EXISTS idx_operations_user ON operations (user_id);