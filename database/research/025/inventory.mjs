#!/usr/bin/env node
// Regenerates view-inventory.json (the reviewed input to build.mjs) from the
// read-only live audit report. Deterministic: same report in, same bytes out.
//
//   node database/research/025/inventory.mjs
//
// The review rule is stated in the output: every public view in the audit is
// a read-only analytical view (security_invoker, not updatable or insertable, no
// INSTEAD OF trigger or rule, no base-table write path for the API roles), so each
// requires SELECT only. The script refuses to write an inventory if the audit
// shows anything that contradicts that rule - a view that needs a human decision
// must be classified by hand, not inferred.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const report = JSON.parse(fs.readFileSync(path.join(here, 'audit-report-live.json'), 'utf8'))

const contradictions = report.inventory.filter((v) => v.classification !== 'READ_ONLY_ANALYTICS'
  || !v.security_invoker || v.is_updatable !== 'NO' || v.is_insertable_into !== 'NO'
  || v.instead_of_triggers.length || v.rules.length || v.base_table_write_policies_for_api_roles.length
  || v.base_tables_without_rls.length || v.public_role.length)
if (contradictions.length) {
  console.error(`views that need a manual decision: ${contradictions.map((v) => v.view).join(', ')}`)
  process.exit(1)
}

const out = {
  migration: '025_public_view_grant_hardening',
  reviewed_at: '2026-10-08',
  source: 'audit-report-live.json (read-only catalog audit of the live database after 024)',
  rule: 'Every public view is a read-only analytical/API view: security_invoker, not updatable or insertable, no INSTEAD OF trigger or rule, and no base table grants write access to anon/authenticated. anon and authenticated receive SELECT only; service_role is not changed.',
  intentionally_writable: [],
  views: report.inventory.map((v) => ({
    view: v.view,
    classification: v.classification,
    api_privileges: ['SELECT'],
    live_beyond_select_before_025: v.anon_extra.length > 0 || v.authenticated_extra.length > 0,
    structurally_updatable: v.is_updatable === 'YES' || v.is_insertable_into === 'YES',
    security_invoker: v.security_invoker,
    defined_in_migrations: v.defined_in_migrations,
    read_by_app: v.read_by_app,
    base_tables: v.base_tables,
  })),
}
fs.writeFileSync(path.join(here, 'view-inventory.json'), JSON.stringify(out, null, 2) + '\n')
console.log(`wrote view-inventory.json: ${out.views.length} views, ${out.views.filter((v) => v.live_beyond_select_before_025).length} with broad grants before 025`)
