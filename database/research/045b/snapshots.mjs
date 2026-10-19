// The 045b addition to the DISI v1 product snapshots: the homepage status row. The ten 045a snapshots are unchanged; this is the
// eleventh. Shared by the migration build, the verifier and the tests, like ../045a/snapshots.mjs.

import { SNAPSHOTS, INTERNAL_VIEWS, STAGED_FUNCTIONS, SERVING_FUNCTIONS } from '../045a/snapshots.mjs'

/**
 * product_database_status: the legacy home-page status row (v_database_status, 26 columns), persisted. The generation metadata comes
 * from the executive snapshot written earlier in the same refresh, so the two always describe the same generation. The comparison with
 * the source ignores the metadata columns (they record WHEN and WHICH VERSION, not WHAT); the executive snapshot's own drift check
 * covers them.
 */
export const STATUS_SNAPSHOT = {
  table: 'product_database_status',
  grain: 'one row: the database status shown on the home page (v_database_status), with the generation metadata of the executive snapshot',
  area: 'EXECUTIVE', tier: 'EXECUTIVE', routes: ['/'],
  purpose: 'Home-page database status: tracked signings, outcome audits, known cost, class coverage and open research tasks (persisted; refreshed explicitly)',
  source: `select e.generated_at, e.source_data_as_of_date, e.product_version, e.schema_version, s.*
  from public.v_database_status s cross join public.product_executive_snapshot e`,
  volatile: ['generated_at', 'source_data_as_of_date', 'product_version', 'schema_version'],
}

/** v_database_status leaves the public API: the home page reads the snapshot. It stays as the internal source. */
export const NEWLY_INTERNAL_VIEWS = ['v_database_status']

export const ALL_SNAPSHOTS = [...SNAPSHOTS, STATUS_SNAPSHOT]
export const ALL_SNAPSHOT_TABLES = ALL_SNAPSHOTS.map((s) => s.table)
export const ALL_INTERNAL_VIEWS = [...INTERNAL_VIEWS, ...NEWLY_INTERNAL_VIEWS]
export { STAGED_FUNCTIONS, SERVING_FUNCTIONS }
