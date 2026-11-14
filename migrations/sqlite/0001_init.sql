-- Medora SQLite 0001_init — self-contained embedded database (Phase 4 SQLite).
-- Mirrors platform/db/migrations/0001_init.sql + 0002_search.sql semantics:
--   serial/bigint IDENTITY -> INTEGER PRIMARY KEY (rowid alias; explicit-id
--     inserts during migration preserve every existing ID, new rows continue
--     from max+1 exactly like the Postgres sequences),
--   timestamptz -> TEXT ISO-8601 UTC, boolean -> INTEGER 0/1,
--   text[] -> TEXT (JSON array), jsonb -> TEXT (JSON),
--   numeric(12,2) -> NUMERIC affinity (stored as REAL/INT; exact value,
--     formatting handled at the API layer).
--   pg_trgm gin indexes + tsvector -> FTS5 external-content tables
--     (unicode61 lexical + trigram fuzzy), kept in sync by triggers.
-- Applied by `npm run db:migrate` (ledger in _medora_migrations).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS _medora_migrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sources (
  id           INTEGER PRIMARY KEY,
  key          TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  base_url     TEXT NOT NULL,
  api_endpoint TEXT,
  robots_note  TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO sources (key, name, base_url, api_endpoint, robots_note)
VALUES ('arogga', 'Arogga', 'https://www.arogga.com', 'https://api.arogga.com/general/v3/search',
        'api.arogga.com/robots.txt currently disallows crawling; keep request volume modest and contact the source before commercial reuse.')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS companies (
  id         INTEGER PRIMARY KEY,
  source_id  INTEGER NOT NULL REFERENCES sources(id),
  source_key TEXT NOT NULL,             -- 'id:37' or 'name:skin-o'
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (source_id, source_key)
);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY,
  source_id  INTEGER NOT NULL REFERENCES sources(id),
  source_key TEXT NOT NULL,             -- 'id:6574'
  type       TEXT,                      -- top-level product type (medicine, beauty, ...)
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  parent_id  INTEGER REFERENCES categories(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (source_id, source_key)
);
CREATE INDEX IF NOT EXISTS categories_type_idx ON categories (type);

CREATE TABLE IF NOT EXISTS medicines (
  id                    INTEGER PRIMARY KEY,
  source_id             INTEGER NOT NULL REFERENCES sources(id),
  source_product_id     INTEGER NOT NULL,      -- p_id in the source API
  name                  TEXT NOT NULL,         -- p_name
  name_bn               TEXT,                  -- p_name_bn
  slug                  TEXT NOT NULL UNIQUE,
  generic_name          TEXT,                  -- p_generic_name
  generic_source_id     INTEGER,               -- p_generic_id
  strength              TEXT,                  -- p_strength
  dosage_form           TEXT,                  -- p_form
  product_type          TEXT,                  -- p_type
  prescription_required INTEGER NOT NULL DEFAULT 0 CHECK (prescription_required IN (0,1)), -- p_rx_req
  active_status         TEXT,                  -- p_active_status
  allow_sales           INTEGER NOT NULL DEFAULT 1 CHECK (allow_sales IN (0,1)),           -- p_allow_sales
  variant_count         INTEGER,               -- p_variant_count
  min_qty               INTEGER,               -- pv_b2c_min_qty (base variant)
  max_qty               INTEGER,               -- pv_b2c_max_qty (base variant)
  verification_status   TEXT NOT NULL DEFAULT 'PARTIALLY_VERIFIED'
                        CHECK (verification_status IN ('VERIFIED','PARTIALLY_VERIFIED','NEEDS_RECHECK','FAILED')),
  missing_fields        TEXT NOT NULL DEFAULT '[]',  -- JSON array (was text[])
  source_url            TEXT,
  company_id            INTEGER REFERENCES companies(id),
  primary_category_id   INTEGER REFERENCES categories(id),
  last_imported_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_verified_at      TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (source_id, source_product_id)
);
CREATE INDEX IF NOT EXISTS medicines_name_lower_idx ON medicines (name);
CREATE INDEX IF NOT EXISTS medicines_type_idx       ON medicines (product_type);
CREATE INDEX IF NOT EXISTS medicines_form_idx       ON medicines (dosage_form);
CREATE INDEX IF NOT EXISTS medicines_company_idx    ON medicines (company_id);
CREATE INDEX IF NOT EXISTS medicines_category_idx   ON medicines (primary_category_id);
CREATE INDEX IF NOT EXISTS medicines_verified_idx   ON medicines (last_verified_at);
CREATE INDEX IF NOT EXISTS medicines_generic_idx    ON medicines (generic_name);

CREATE TABLE IF NOT EXISTS medicine_categories (
  medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  is_primary  INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (medicine_id, category_id)
);
CREATE INDEX IF NOT EXISTS medicine_categories_category_idx ON medicine_categories (category_id);

CREATE TABLE IF NOT EXISTS scrape_runs (
  id                 INTEGER PRIMARY KEY,
  run_id             TEXT NOT NULL UNIQUE,
  mode               TEXT NOT NULL,
  source             TEXT NOT NULL DEFAULT 'crawl',  -- crawl | import | ingest
  status             TEXT NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running','completed','partial','failed')),
  started_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at        TEXT,
  duration_ms        INTEGER,
  api_requests       INTEGER,
  pages_discovered   INTEGER,
  pages_processed    INTEGER,
  products_collected INTEGER,
  coverage_pct       NUMERIC(5,2),
  full_coverage      INTEGER CHECK (full_coverage IN (0,1)),
  stats              TEXT,               -- JSON (was jsonb)
  coverage_gaps      TEXT                -- JSON (was jsonb)
);

CREATE TABLE IF NOT EXISTS medicine_prices (
  medicine_id           INTEGER PRIMARY KEY REFERENCES medicines(id) ON DELETE CASCADE,
  -- Base unit = smallest selling unit (e.g. per Tablet).
  base_unit             TEXT,            -- pu_base_unit_label
  base_unit_multiplier  NUMERIC(10,2),   -- pu_base_unit_multiplier
  regular_base          NUMERIC(12,2),   -- pv_mrp
  offer_base            NUMERIC(12,2),   -- pv_b2c_discounted_price
  -- Sales unit = customer-facing pack (e.g. per Strip). NEVER mixed with base-unit columns.
  sales_unit            TEXT,            -- pu_b2c_sales_unit_label
  sales_unit_multiplier NUMERIC(10,2),   -- pu_b2c_base_unit_multiplier
  regular_sales         NUMERIC(12,2),   -- pv_b2c_mrp
  offer_sales           NUMERIC(12,2),   -- pv_b2c_price
  discount_percent      NUMERIC(5,2),    -- pv_b2c_discount_percent (as listed; never recomputed)
  price_source          TEXT NOT NULL DEFAULT 'api'
                        CHECK (price_source IN ('api','api_plus_detail','detail_page')),
  scrape_run_id         INTEGER REFERENCES scrape_runs(id),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS medicine_prices_offer_idx   ON medicine_prices (offer_sales);
CREATE INDEX IF NOT EXISTS medicine_prices_regular_idx ON medicine_prices (regular_sales);
CREATE INDEX IF NOT EXISTS medicine_prices_updated_idx ON medicine_prices (updated_at);

CREATE TABLE IF NOT EXISTS price_history (
  id             INTEGER PRIMARY KEY,
  medicine_id    INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  regular_base   NUMERIC(12,2),
  offer_base     NUMERIC(12,2),
  regular_sales  NUMERIC(12,2),
  offer_sales    NUMERIC(12,2),
  changed_fields TEXT NOT NULL DEFAULT '[]',  -- JSON array (was text[])
  scrape_run_id  INTEGER REFERENCES scrape_runs(id),
  recorded_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS price_history_medicine_idx ON price_history (medicine_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS product_images (
  id           INTEGER PRIMARY KEY,
  medicine_id  INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  cdn_key      TEXT,
  title        TEXT,
  is_primary   INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  available    INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
  validated_at TEXT,
  UNIQUE (medicine_id, url)
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id            INTEGER PRIMARY KEY,
  scrape_run_id INTEGER REFERENCES scrape_runs(id),
  mode          TEXT NOT NULL DEFAULT 'full',      -- full | resume | dry-run
  status        TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','completed','failed','aborted')),
  input_files   TEXT NOT NULL DEFAULT '[]',        -- JSON array (was text[])
  totals        TEXT,                              -- JSON (was jsonb)
  checkpoint    TEXT,                              -- JSON (was jsonb)
  error         TEXT,
  started_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at   TEXT
);

CREATE TABLE IF NOT EXISTS data_validations (
  id            INTEGER PRIMARY KEY,
  medicine_id   INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  import_job_id INTEGER REFERENCES import_jobs(id),
  status        TEXT NOT NULL
                CHECK (status IN ('VERIFIED','PARTIALLY_VERIFIED','NEEDS_RECHECK','FAILED')),
  issues        TEXT,                              -- JSON (was jsonb)
  conflicts     TEXT,                              -- JSON (was jsonb)
  duplicate_of  INTEGER REFERENCES medicines(id),  -- fuzzy duplicate candidate target; never merged automatically
  checked_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS data_validations_medicine_idx ON data_validations (medicine_id);
CREATE INDEX IF NOT EXISTS data_validations_status_idx   ON data_validations (status);

CREATE TABLE IF NOT EXISTS slug_redirects (
  id         INTEGER PRIMARY KEY,
  old_slug   TEXT NOT NULL UNIQUE,
  new_slug   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------- search infrastructure (replaces tsvector + pg_trgm) ----------
-- Lexical index (unicode61): weights applied at query time via bm25() column
-- weights (name weighted highest).
CREATE VIRTUAL TABLE IF NOT EXISTS medicines_fts USING fts5(
  name, generic_name, strength, dosage_form,
  content='medicines', content_rowid='id',
  tokenize='unicode61 remove_diacritics 1'
);
-- Fuzzy index (trigram): powers typo tolerance + substring matching, replacing
-- pg_trgm similarity conditions.
CREATE VIRTUAL TABLE IF NOT EXISTS medicines_fuzzy USING fts5(
  name, generic_name,
  content='medicines', content_rowid='id',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS medicines_fts_ai AFTER INSERT ON medicines BEGIN
  INSERT INTO medicines_fts(rowid, name, generic_name, strength, dosage_form)
    VALUES (new.id, new.name, new.generic_name, new.strength, new.dosage_form);
  INSERT INTO medicines_fuzzy(rowid, name, generic_name)
    VALUES (new.id, new.name, new.generic_name);
END;
CREATE TRIGGER IF NOT EXISTS medicines_fts_ad AFTER DELETE ON medicines BEGIN
  INSERT INTO medicines_fts(medicines_fts, rowid, name, generic_name, strength, dosage_form)
    VALUES ('delete', old.id, old.name, old.generic_name, old.strength, old.dosage_form);
  INSERT INTO medicines_fuzzy(medicines_fuzzy, rowid, name, generic_name)
    VALUES ('delete', old.id, old.name, old.generic_name);
END;
CREATE TRIGGER IF NOT EXISTS medicines_fts_au AFTER UPDATE OF name, generic_name, strength, dosage_form ON medicines BEGIN
  INSERT INTO medicines_fts(medicines_fts, rowid, name, generic_name, strength, dosage_form)
    VALUES ('delete', old.id, old.name, old.generic_name, old.strength, old.dosage_form);
  INSERT INTO medicines_fts(rowid, name, generic_name, strength, dosage_form)
    VALUES (new.id, new.name, new.generic_name, new.strength, new.dosage_form);
  INSERT INTO medicines_fuzzy(medicines_fuzzy, rowid, name, generic_name)
    VALUES ('delete', old.id, old.name, old.generic_name);
  INSERT INTO medicines_fuzzy(rowid, name, generic_name)
    VALUES (new.id, new.name, new.generic_name);
END;
