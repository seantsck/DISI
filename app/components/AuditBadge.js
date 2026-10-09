import { auditLabel } from '../../lib/format.js'

/** Outcome-audit state. "Not audited" is a research gap, never a failure. */
export default function AuditBadge({ status }) {
  return <span className={`audit-badge audit-${String(status || 'NOT_AUDITED').toLowerCase()}`}>{auditLabel(status)}</span>
}
