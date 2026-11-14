-- Medora 0002_search — full-text + trigram search infrastructure.

BEGIN;

ALTER TABLE medicines ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(generic_name, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(strength, '') || ' ' || coalesce(dosage_form, '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS medicines_search_vector_idx ON medicines USING gin (search_vector);
-- Additional per-token prefix support for suggestion queries:
CREATE INDEX IF NOT EXISTS medicines_generic_lower_idx ON medicines (lower(generic_name));

COMMIT;
