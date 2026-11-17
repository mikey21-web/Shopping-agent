-- SahiPick database schema.
-- All monetary values are integer paise. All timestamps are ISO-8601 UTC strings.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
  id                TEXT PRIMARY KEY,
  brand             TEXT NOT NULL,
  model             TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  category          TEXT NOT NULL,
  identity_key      TEXT NOT NULL,
  variant_key       TEXT,
  specs_json        TEXT NOT NULL DEFAULT '{}',
  raw_specs_json    TEXT NOT NULL DEFAULT '[]',
  highlights_json   TEXT NOT NULL DEFAULT '[]',
  image_url         TEXT,
  specs_verified    INTEGER NOT NULL DEFAULT 0,
  spec_sources_json TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_identity  ON products(identity_key);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_model    ON products(brand, model);

CREATE TABLE IF NOT EXISTS product_variants (
  id                TEXT PRIMARY KEY,
  product_id        TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label             TEXT NOT NULL,
  config_signature  TEXT NOT NULL,
  specs_json        TEXT NOT NULL DEFAULT '{}',
  part_number       TEXT,
  sku               TEXT,
  gtin              TEXT,
  colour            TEXT,
  image_url         TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_product_sig ON product_variants(product_id, config_signature);
CREATE INDEX IF NOT EXISTS idx_variants_part_number ON product_variants(part_number);

CREATE TABLE IF NOT EXISTS retailer_listings (
  id                 TEXT PRIMARY KEY,
  variant_id         TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  product_id         TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  retailer           TEXT NOT NULL,
  retailer_product_id TEXT NOT NULL,
  title              TEXT NOT NULL,
  url                TEXT NOT NULL,
  list_price_paise   INTEGER NOT NULL,
  mrp_paise          INTEGER,
  condition          TEXT NOT NULL DEFAULT 'new',
  in_stock           INTEGER NOT NULL DEFAULT 1,
  seller             TEXT,
  rating             REAL,
  rating_count       INTEGER,
  review_count       INTEGER,
  image_url          TEXT,
  delivery_fee_paise INTEGER NOT NULL DEFAULT 0,
  provenance_json    TEXT NOT NULL,
  first_seen_at      TEXT NOT NULL,
  last_seen_at       TEXT NOT NULL,
  UNIQUE (retailer, retailer_product_id)
);

CREATE INDEX IF NOT EXISTS idx_listings_product   ON retailer_listings(product_id);
CREATE INDEX IF NOT EXISTS idx_listings_variant   ON retailer_listings(variant_id);
CREATE INDEX IF NOT EXISTS idx_listings_retailer ON retailer_listings(retailer);

CREATE TABLE IF NOT EXISTS offers (
  id                 TEXT PRIMARY KEY,
  listing_id         TEXT NOT NULL REFERENCES retailer_listings(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL,
  title              TEXT NOT NULL,
  description        TEXT,
  percent_off        REAL,
  flat_off_paise     INTEGER,
  cashback_paise     INTEGER,
  conditions_json    TEXT NOT NULL DEFAULT '{}',
  stackability       TEXT NOT NULL DEFAULT 'stackable',
  automatic          INTEGER NOT NULL DEFAULT 0,
  validity_start     TEXT,
  validity_end       TEXT,
  provenance_json    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_offers_listing ON offers(listing_id);

CREATE TABLE IF NOT EXISTS price_points (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id    TEXT NOT NULL REFERENCES retailer_listings(id) ON DELETE CASCADE,
  price_paise   INTEGER NOT NULL,
  recorded_at   TEXT NOT NULL,
  provenance_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_points_listing ON price_points(listing_id, recorded_at);

CREATE TABLE IF NOT EXISTS reviews (
  id                TEXT PRIMARY KEY,
  listing_id        TEXT REFERENCES retailer_listings(id) ON DELETE CASCADE,
  product_id        TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  title             TEXT,
  body              TEXT NOT NULL,
  rating            REAL NOT NULL,
  author            TEXT,
  verified_purchase INTEGER,
  reviewed_at       TEXT,
  helpful_votes     INTEGER,
  language          TEXT NOT NULL DEFAULT 'en',
  aspect_ratings_json TEXT,
  provenance_json   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_listing ON reviews(listing_id);

CREATE TABLE IF NOT EXISTS review_intelligence (
  id                 TEXT PRIMARY KEY,
  product_id         TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  listing_id         TEXT,
  analysed_at        TEXT NOT NULL,
  review_count       INTEGER NOT NULL,
  verified_ratio     REAL NOT NULL,
  average_rating     REAL NOT NULL,
  negative_share     REAL NOT NULL,
  authenticity_risk  REAL NOT NULL,
  signals_json       TEXT NOT NULL DEFAULT '[]',
  aspects_json       TEXT NOT NULL DEFAULT '[]',
  positives_json     TEXT NOT NULL DEFAULT '[]',
  complaints_json    TEXT NOT NULL DEFAULT '[]',
  long_term_json     TEXT NOT NULL DEFAULT '[]',
  language_breakdown_json TEXT NOT NULL DEFAULT '{}',
  provenance_json    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_intel_product ON review_intelligence(product_id);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id           TEXT PRIMARY KEY,
  retailer     TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  status       TEXT NOT NULL,
  items_seen   INTEGER NOT NULL DEFAULT 0,
  items_written INTEGER NOT NULL DEFAULT 0,
  message      TEXT
);

CREATE TABLE IF NOT EXISTS price_alerts (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  target_paise  INTEGER NOT NULL,
  retailer      TEXT,
  created_at    TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------
-- Web research
--
-- Every fact gathered from the open web is stored with its full
-- provenance: where it came from, when it was retrieved, when it was
-- verified, how it was extracted, and how much we trust it.
--
-- Facts are keyed by product + variant + kind + key, so a re-run replaces
-- the current value while the observation history preserves the series.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS research_facts (
  id                   TEXT PRIMARY KEY,
  product_id           TEXT NOT NULL,
  variant_id           TEXT,
  fact_kind            TEXT NOT NULL,
  fact_key             TEXT NOT NULL,
  value_text           TEXT,
  value_number         REAL,
  value_bool           INTEGER,
  unit                 TEXT,
  source_url           TEXT NOT NULL,
  source_domain        TEXT NOT NULL,
  retrieved_at         TEXT NOT NULL,
  verified_at          TEXT,
  evidence_excerpt     TEXT,
  evidence_locator     TEXT,
  confidence           REAL NOT NULL DEFAULT 0,
  origin               TEXT NOT NULL DEFAULT 'live',
  extraction_method    TEXT NOT NULL,
  freshness            TEXT NOT NULL DEFAULT 'unknown',
  verification_status  TEXT NOT NULL DEFAULT 'unverifiable',
  corroborating_sources INTEGER NOT NULL DEFAULT 0,
  conflicting_sources_json TEXT NOT NULL DEFAULT '[]',
  research_run_id      TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_facts_product ON research_facts(product_id, fact_kind);
CREATE INDEX IF NOT EXISTS idx_research_facts_key     ON research_facts(fact_kind, fact_key);
CREATE INDEX IF NOT EXISTS idx_research_facts_run     ON research_facts(research_run_id);

-- Append-only observation history. A price series is built from these rows
-- and from nowhere else.
CREATE TABLE IF NOT EXISTS research_observations (
  id                TEXT PRIMARY KEY,
  fact_id           TEXT NOT NULL,
  product_id        TEXT NOT NULL,
  variant_id        TEXT,
  fact_kind         TEXT NOT NULL,
  fact_key          TEXT NOT NULL,
  value_text        TEXT,
  value_number      REAL,
  source_url        TEXT NOT NULL,
  source_domain     TEXT NOT NULL,
  observed_at       TEXT NOT NULL,
  research_run_id   TEXT
);

CREATE INDEX IF NOT EXISTS idx_research_obs_product ON research_observations(product_id, fact_kind, observed_at);

CREATE TABLE IF NOT EXISTS research_runs (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL,
  variant_id    TEXT,
  category      TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  status        TEXT NOT NULL,
  facts_found   INTEGER NOT NULL DEFAULT 0,
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_research_runs_product ON research_runs(product_id, started_at);

-- Unresolved contradictions between sources. These are surfaced to the
-- user rather than resolved by guessing.
CREATE TABLE IF NOT EXISTS research_conflicts (
  id            TEXT PRIMARY KEY,
  research_run_id TEXT,
  product_id    TEXT NOT NULL,
  fact_kind     TEXT NOT NULL,
  fact_key      TEXT NOT NULL,
  positions_json TEXT NOT NULL,
  explanation   TEXT NOT NULL,
  resolution    TEXT NOT NULL,
  detected_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_conflicts_product ON research_conflicts(product_id);
