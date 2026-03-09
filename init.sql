-- SatvikScan: Ingredient Cache Schema
-- Auto-applied on first PostgreSQL container start via docker-entrypoint-initdb.d

-- Extensions for fuzzy matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- Main cache table
CREATE TABLE ingredient_cache (
    id                  BIGSERIAL PRIMARY KEY,

    -- Fast exact lookup via hash of normalized sorted ingredients
    ingredients_hash    TEXT NOT NULL UNIQUE,

    -- Core data: sorted, normalized, lowercase ingredients as text array
    ingredients_array   TEXT[] NOT NULL,

    -- Concatenated string for trigram fuzzy search (computed in app layer)
    ingredients_text    TEXT NOT NULL,

    -- Full compliance result as JSONB
    compliance          JSONB NOT NULL,

    -- Metadata
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    source              TEXT,
    confidence          NUMERIC(4,3) DEFAULT 0.950,
    hit_count           BIGINT DEFAULT 0
);

-- Indexes
CREATE INDEX idx_ingredient_cache_array_exact  ON ingredient_cache USING GIN (ingredients_array);
CREATE INDEX idx_ingredient_cache_text_trgm    ON ingredient_cache USING GIN (ingredients_text gin_trgm_ops);
CREATE INDEX idx_ingredient_cache_compliance   ON ingredient_cache USING GIN (compliance);

-- Scan log table (tracks per-user scan history)
CREATE TABLE IF NOT EXISTS scans (
    id              BIGSERIAL PRIMARY KEY,
    user_name       TEXT NOT NULL,
    user_email      TEXT NOT NULL,
    cache_id        BIGINT REFERENCES ingredient_cache(id) ON DELETE SET NULL,
    compliance      JSONB NOT NULL,
    ingredients     TEXT[] NOT NULL,
    source          TEXT,
    scanned_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scans_user_email ON scans (user_email);
CREATE INDEX idx_scans_scanned_at ON scans (scanned_at DESC);
