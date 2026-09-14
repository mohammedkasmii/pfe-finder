-- Secondary duplicate detection: (source_key, external_id) stays the
-- primary identity (unchanged, still the upsert conflict target), but two
-- rows for the same source must never share a canonical URL fingerprint
-- either — that would mean the same posting was recorded twice under two
-- different external IDs (e.g. the source reissued a new ID for an
-- unchanged listing). A plain index cannot enforce this, only a
-- constraint can.
alter table public.offers
  add constraint offers_source_canonical_unique unique (source_key, canonical_url_hash);
