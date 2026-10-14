-- DISI product snapshots (Migration 045a): refresh as one validated generation (WRITE; privileged credentials only).
--
-- The same work as `npm run refresh:product-snapshots`, for the secret-safe release runner (psql -X -v ON_ERROR_STOP=1 -f):
-- one transaction; the function rebuilds every snapshot one staged statement at a time and validates the support chain before the
-- commit; readers keep the previous generation until then. A refused validation raises and nothing changes.

begin;
set local statement_timeout = '600s';
select snapshot, row_count, elapsed_ms from public.disi_refresh_product_snapshots();
select generation_id, generated_at, source_data_as_of_date, product_version, schema_version, support_chain_state
from public.product_executive_snapshot;
commit;
