// Table specifications for the research tables. Columns reference the
// security-invoker views created in database/sql/017_research_database_layer.sql.

export const AUDIT_STATUSES = ['VERIFIED_MLB', 'VERIFIED_NO_MLB', 'NOT_AUDITED']

/** @type {import('./table-state.js').TableSpec} */
export const SIGNINGS_SPEC = {
  pageSize: 50,
  sorts: {
    player: { column: 'player_sort_name', type: 'text' },
    year: { column: 'signing_year', type: 'number' },
    date: { column: 'signing_date', type: 'date' },
    org: { column: 'organization', type: 'text' },
    market: { column: 'country_market', type: 'text' },
    position: { column: 'primary_position', type: 'text' },
    pathway: { column: 'pathway', type: 'text' },
    bonus: { column: 'signing_bonus_usd', type: 'money' },
    posting: { column: 'posting_fee_usd', type: 'money' },
    transfer: { column: 'transfer_fee_usd', type: 'money' },
    cost: { column: 'total_known_acquisition_cost_usd', type: 'money' },
    rank: { column: 'international_rank', type: 'number' },
    scope: { column: 'record_scope', type: 'text' },
    coverage: { column: 'coverage_type', type: 'text' },
    audit: { column: 'outcome_audit_status', type: 'text' },
    mlb: { column: 'reached_mlb_verified', type: 'boolean' },
    debut: { column: 'mlb_debut_date', type: 'date' },
    debutorg: { column: 'mlb_debut_org', type: 'text' },
    bwar: { column: 'career_bwar', type: 'number' },
  },
  defaultSort: { key: 'year', dir: 'desc' },
  tiebreak: [
    { column: 'player_sort_name', ascending: true },
    { column: 'signing_id', ascending: true },
  ],
  filters: {
    q: { kind: 'search', column: 'search_text' },
    org_scope: {
      kind: 'scope',
      default: 'dodgers',
      options: { dodgers: { column: 'is_dodgers_franchise', value: true }, all: null },
    },
    year: { kind: 'year', column: 'signing_year', op: 'eq' },
    year_min: { kind: 'year', column: 'signing_year', op: 'gte' },
    year_max: { kind: 'year', column: 'signing_year', op: 'lte' },
    market: { kind: 'value', column: 'country_market' },
    position: { kind: 'value', column: 'primary_position' },
    pathway: { kind: 'value', column: 'pathway' },
    audit: { kind: 'enum', column: 'outcome_audit_status', values: AUDIT_STATUSES },
    mlb: { kind: 'tristate', column: 'reached_mlb_verified' },
    dodgers_debut: { kind: 'bool', column: 'direct_dodgers_franchise_debut' },
    record_scope: { kind: 'value', column: 'record_scope' },
    coverage: { kind: 'value', column: 'coverage_type' },
    org: { kind: 'value', column: 'organization' },
  },
}

/** @type {import('./table-state.js').TableSpec} */
export const PLAYERS_SPEC = {
  pageSize: 60,
  sorts: {
    player: { column: 'player_sort_name', type: 'text' },
    country: { column: 'first_signing_market', type: 'text' },
    position: { column: 'primary_position', type: 'text' },
    first_year: { column: 'first_signing_year', type: 'number' },
    audit: { column: 'outcome_audit_status', type: 'text' },
    debut: { column: 'mlb_debut_date', type: 'date' },
    bwar: { column: 'career_bwar', type: 'number' },
  },
  defaultSort: { key: 'player', dir: 'asc' },
  tiebreak: [
    { column: 'player_sort_name', ascending: true },
    { column: 'player_id', ascending: true },
  ],
  filters: {
    q: { kind: 'search', column: 'search_text' },
    org_scope: {
      kind: 'scope',
      default: 'dodgers',
      options: { dodgers: { column: 'has_dodgers_signing', value: true }, all: null },
    },
    letter: { kind: 'value', column: 'name_initial' },
    country: { kind: 'contains', column: 'countries' },
    position: { kind: 'value', column: 'primary_position' },
    year_min: { kind: 'year', column: 'first_signing_year', op: 'gte' },
    year_max: { kind: 'year', column: 'first_signing_year', op: 'lte' },
    mlb: { kind: 'tristate', column: 'reached_mlb_verified' },
    dodgers_debut: { kind: 'bool', column: 'direct_dodgers_franchise_debut' },
    audit: { kind: 'enum', column: 'outcome_audit_status', values: AUDIT_STATUSES },
  },
}
