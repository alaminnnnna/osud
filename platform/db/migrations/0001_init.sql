-- Medora 0001_init — core tables. Applied by `npm run db:migrate` (ledger in _medora_migrations).
-- Column comments preserve the original source-API field names for every price column.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS sources (
  id            smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key           text NOT NULL UNIQUE,
  name          text NOT NULL,
  base_url      text NOT NULL,
  api_endpoint  text,
  robots_note   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sources (key, name, base_url, api_endpoint, robots_note)
VALUES ('arogga', 'Arogga', 'https://www.arogga.com', 'https://api.arogga.com/general/v3/search',
        'api.arogga.com/robots.txt currently disallows crawling; keep request volume modest and contact the source before commercial reuse.')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS companies (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id        smallint NOT NULL REFERENCES sources(id),
  source_key       text NOT NULL,             -- 'id:37' or 'name:skin-o'
  name             text NOT NULL,
  slug             text NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, source_key)
);
CREATE INDEX IF NOT EXISTS companies_name_trgm ON companies USING gin (name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS categories (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id    smallint NOT NULL REFERENCES sources(id),
  source_key   text NOT NULL,                 -- 'id:6574'
  type         text,                          -- top-level product type (medicine, beauty, ...)
  name         text NOT NULL,
  slug         text NOT NULL UNIQUE,
  parent_id    integer REFERENCES categories(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, source_key)
);
CREATE INDEX IF NOT EXISTS categories_type_idx ON categories (type);
CREATE INDEX IF NOT EXISTS categories_name_trgm ON categories USING gin (name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS medicines (
  id                    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id             smallint NOT NULL REFERENCES sources(id),
  source_product_id     integer NOT NULL,      -- p_id in the source API
  name                  text NOT NULL,         -- p_name
  name_bn               text,                  -- p_name_bn
  slug                  text NOT NULL UNIQUE,
  generic_name          text,                  -- p_generic_name
  generic_source_id     integer,               -- p_generic_id
  strength              text,                  -- p_strength
  dosage_form           text,                  -- p_form
  product_type          text,                  -- p_type
  prescription_required boolean NOT NULL DEFAULT false, -- p_rx_req
  active_status         text,                  -- p_active_status
  allow_sales           boolean NOT NULL DEFAULT true,  -- p_allow_sales
  variant_count         integer,               -- p_variant_count
  min_qty               integer,               -- pv_b2c_min_qty (base variant)
  max_qty               integer,               -- pv_b2c_max_qty (base variant)
  verification_status   text NOT NULL DEFAULT 'PARTIALLY_VERIFIED'
                        CHECK (verification_status IN ('VERIFIED','PARTIALLY_VERIFIED','NEEDS_RECHECK','FAILED')),
  missing_fields        text[] NOT NULL DEFAULT '{}',
  source_url            text,
  company_id            integer REFERENCES companies(id),
  primary_category_id   integer REFERENCES categories(id),
  last_imported_at      timestamptz NOT NULL DEFAULT now(),
  last_verified_at      timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, source_product_id)
);
CREATE INDEX IF NOT EXISTS medicines_name_trgm        ON medicines USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS medicines_generic_trgm     ON medicines USING gin (generic_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS medicines_name_lower_idx   ON medicines (lower(name));
CREATE INDEX IF NOT EXISTS medicines_type_idx         ON medicines (product_type);
CREATE INDEX IF NOT EXISTS medicines_form_idx         ON medicines (dosage_form);
CREATE INDEX IF NOT EXISTS medicines_company_idx      ON medicines (company_id);
CREATE INDEX IF NOT EXISTS medicines_category_idx     ON medicines (primary_category_id);
CREATE INDEX IF NOT EXISTS medicines_verified_idx     ON medicines (last_verified_at);

CREATE TABLE IF NOT EXISTS medicine_categories (
  medicine_id integer NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  category_id integer NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  is_primary  boolean NOT NULL DEFAULT false,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (medicine_id, category_id)
);
CREATE INDEX IF NOT EXISTS medicine_categories_category_idx ON medicine_categories (category_id);

CREATE TABLE IF NOT EXISTS scrape_runs (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id            text NOT NULL UNIQUE,
  mode              text NOT NULL,
  source            text NOT NULL DEFAULT 'crawl',  -- crawl | import | ingest
  status            text NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','completed','partial','failed')),
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  duration_ms       integer,
  api_requests      integer,
  pages_discovered  integer,
  pages_processed   integer,
  products_collected integer,
  coverage_pct      numeric(5,2),
  full_coverage     boolean,
  stats             jsonb,
  coverage_gaps     jsonb
);

CREATE TABLE IF NOT EXISTS medicine_prices (
  medicine_id           integer PRIMARY KEY REFERENCES medicines(id) ON DELETE CASCADE,
  -- Base unit = smallest selling unit (e.g. per Tablet).
  base_unit             text,            -- pu_base_unit_label
  base_unit_multiplier  numeric(10,2),   -- pu_base_unit_multiplier
  regular_base          numeric(12,2),   -- pv_mrp
  offer_base            numeric(12,2),   -- pv_b2c_discounted_price
  -- Sales unit = customer-facing pack (e.g. per Strip). NEVER mixed with base-unit columns.
  sales_unit            text,            -- pu_b2c_sales_unit_label
  sales_unit_multiplier numeric(10,2),   -- pu_b2c_base_unit_multiplier
  regular_sales         numeric(12,2),   -- pv_b2c_mrp
  offer_sales           numeric(12,2),   -- pv_b2c_price
  discount_percent      numeric(5,2),    -- pv_b2c_discount_percent (as listed; never recomputed)
  price_source          text NOT NULL DEFAULT 'api'
                        CHECK (price_source IN ('api','api_plus_detail','detail_page')),
  scrape_run_id         integer REFERENCES scrape_runs(id),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS medicine_prices_offer_idx ON medicine_prices (offer_sales);
CREATE INDEX IF NOT EXISTS medicine_prices_regular_idx ON medicine_prices (regular_sales);
CREATE INDEX IF NOT EXISTS medicine_prices_updated_idx ON medicine_prices (updated_at);

CREATE TABLE IF NOT EXISTS price_history (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  medicine_id    integer NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  regular_base   numeric(12,2),
  offer_base     numeric(12,2),
  regular_sales  numeric(12,2),
  offer_sales    numeric(12,2),
  changed_fields text[] NOT NULL DEFAULT '{}',
  scrape_run_id  integer REFERENCES scrape_runs(id),
  recorded_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS price_history_medicine_idx ON price_history (medicine_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS product_images (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  medicine_id  integer NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  url          text NOT NULL,
  cdn_key      text,
  title        text,
  is_primary   boolean NOT NULL DEFAULT false,
  available    boolean NOT NULL DEFAULT true,
  validated_at timestamptz,
  UNIQUE (medicine_id, url)
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scrape_run_id integer REFERENCES scrape_runs(id),
  mode          text NOT NULL DEFAULT 'full',      -- full | resume | dry-run
  status        text NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','completed','failed','aborted')),
  input_files   text[] NOT NULL DEFAULT '{}',
  totals        jsonb,
  checkpoint    jsonb,
  error         text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);

CREATE TABLE IF NOT EXISTS data_validations (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  medicine_id   integer NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  import_job_id bigint REFERENCES import_jobs(id),
  status        text NOT NULL
                CHECK (status IN ('VERIFIED','PARTIALLY_VERIFIED','NEEDS_RECHECK','FAILED')),
  issues        jsonb,
  conflicts     jsonb,
  duplicate_of  integer REFERENCES medicines(id),  -- fuzzy duplicate candidate target; never merged automatically
  checked_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS data_validations_medicine_idx ON data_validations (medicine_id);
CREATE INDEX IF NOT EXISTS data_validations_status_idx ON data_validations (status);

CREATE TABLE IF NOT EXISTS slug_redirects (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  old_slug   text NOT NULL UNIQUE,
  new_slug   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
