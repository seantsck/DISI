# Migration 030: schema design

## Model

```
signings (unchanged money columns = compatibility layer, one selected USD value per component)
  signing_bonus_usd / posting_fee_usd / transfer_fee_usd / total_known_acquisition_cost_usd / bonus_publicly_reported
  + international_pool_treatment, _basis, _source_id          (new, additive)
      ^
      | reconciled against
signing_financial_reports        one row per reported amount of one component of one signing
signing_environment_financial_reports   one row per reported pool / period fact of one environment
acquisition_cost_component_rules  pathway x component -> applicability (drives acquisition completeness)
```

### Report vocabulary

| Field | Values |
|---|---|
| `component_type` | SIGNING_BONUS, POSTING_FEE, TRANSFER_FEE, RELEASE_FEE, POOL_CHARGE, OTHER_ACQUISITION_FEE |
| `metric_type` (environment) | BASE_POOL, POOL_AFTER_TRADES, POOL_SPACE_ACQUIRED, POOL_SPACE_SENT, PENALTY_REDUCTION, REPORTED_PERIOD_SPEND, OVERAGE_TAX_RATE, OVERAGE_TAX_PAID, INDIVIDUAL_BONUS_CAP |
| `amount_basis` | EXACT, ROUNDED (+ `amount_precision`), APPROXIMATE, RULE_DERIVED (+ rate, base, rule text); NULL only for LEGACY_CARRYFORWARD |
| `report_origin` | EXTERNAL_SOURCE (source required; field-level provenance), LEGACY_CARRYFORWARD (no source; never counted as sourced; stays queued), RULE_DERIVED (DISI derivation; rule source plus rate and base that reproduce the amount) |
| `currency_code` | `^[A-Z]{3}$`; every current row is USD; no FX table, no conversion |
| `record_status` | ACTIVE, RETRACTED |
| `international_pool_treatment` | SUBJECT, EXEMPT, NOT_SUBJECT, NOT_APPLICABLE, UNKNOWN (+ basis SOURCE_STATEMENT or RULE, + source) |
| rule `applicability` | REQUIRED, POSSIBLE, CONDITIONAL, NOT_APPLICABLE, NO_RULE |

Out of scope by vocabulary: salary, contract guarantees, options, buyouts, agent pay, development
cost, and a period tax amount nobody reported (no `OVERAGE_TAX_PAID` row is derived from a rate).

### Lifecycle

- New rows start ACTIVE. ACTIVE content is sealed; the only allowed update is retraction (with
  timestamp and reason). RETRACTED is sealed. DELETE is refused.
- A correction is a new row with `supersedes_report_id`. It must name a report of the same signing and
  component (or environment and metric); the trigger retires the predecessor. A predecessor has at most
  one replacement (unique index), a row cannot supersede itself (check), and the predecessor must
  already exist, so cycles cannot form.
- **Independent reports that disagree are not a predecessor / successor pair.** Both stay ACTIVE (Sasaki).

### Reconciliation (column vs ledger)

Over ACTIVE USD reports of one signing x component (or environment x metric):

1. points = distinct amounts of EXACT, RULE_DERIVED and legacy carry-forward reports
2. candidates = points, or, when there are none, the distinct ROUNDED amounts
3. no candidate: APPROXIMATE_ONLY. More than one: CONFLICT. One candidate outside any ROUNDED
   report's interval (amount +/- precision / 2): CONFLICT. Otherwise AGREED.
4. A non-null column must equal the AGREED value. Under CONFLICT the column stays NULL. A NULL column
   with an AGREED value is a mismatch. Approximate figures never select a value.

030 has no "reviewed resolution" object. Under a conflict the column therefore stays NULL until a
later migration adds a reviewed resolution (backlog). Identical amounts from different sources are
corroboration. The same source repeating the same amount is one fact (unique index).

### Completeness: two independent dimensions

**Acquisition cost** (`acquisition_cost_completeness`), from the component rules:

- NO_RULE: the pathway has no rule (OTHER).
- COMPLETE: at least one component is known and every REQUIRED and POSSIBLE component is known
  (CONDITIONAL does not block).
- UNKNOWN: no component is known.
- PARTIAL: anything else, including a REQUIRED component under CONFLICT.

It covers bonus, posting, transfer, release and other fees. It excludes pool charge, tax, salary
and development.

**Pool / regulatory** (`pool_completeness`), from treatment, pool charge and environment capacity:

- NOT_APPLICABLE: the treatment is EXEMPT, NOT_SUBJECT or NOT_APPLICABLE.
- UNKNOWN: the treatment is UNKNOWN.
- COMPLETE: SUBJECT, with an AGREED pool charge and a linked environment with known capacity.
- PARTIAL: otherwise.

This dimension never changes acquisition completeness or known cost.

### Component rules (50 rows)

| Pathway | Bonus | Posting | Transfer | Release | Other |
|---|---|---|---|---|---|
| LATAM / CUBAN / JAPAN / KOREA _AMATEUR | REQUIRED | N/A | N/A | N/A | N/A |
| CUBAN_PRO | REQUIRED | N/A | N/A | CONDITIONAL | CONDITIONAL |
| JAPAN_PRO, KOREA_PRO | POSSIBLE | CONDITIONAL | N/A | CONDITIONAL | CONDITIONAL |
| POSTED_PLAYER | POSSIBLE | REQUIRED | N/A | N/A | CONDITIONAL |
| MEXICAN_LEAGUE_TRANSFER | POSSIBLE | N/A | REQUIRED | N/A | CONDITIONAL |
| OTHER | NO_RULE | NO_RULE | NO_RULE | NO_RULE | NO_RULE |

POOL_CHARGE is deliberately not a rule component. The rules imply nothing about pool treatment.

### Pool metrics (kept distinct, in `v_dodgers_financial_commitment_by_class`)

- **A. `source_reported_utilization_pct`:** a source-reported (non-approximate) spend divided by the
  source-reported pool capacity. Today this exists only for 2019-20 (99.8%).
- **B. `known_tracked_bonus_pct_of_pool`:** never called utilization. It always comes with
  `known_tracked_bonus_pct_basis`, which states the denominator, regime, population completeness,
  the number of known bonuses and adjustment completeness.
- **C. `true_disi_row_utilization_pct`:** shown only when the class population is complete, every
  treatment is known, every SUBJECT signing's pool charge is known, and the adjusted pool (after
  trades) is known. Today no period qualifies.

### Security

- RLS and a `public_read_*` SELECT policy on all three tables; revoke all, then SELECT only for anon
  and authenticated.
- No write policy and no PUBLIC grant. All four views are `security_invoker`.
- Both guard functions are SECURITY INVOKER with `search_path = ''` and EXECUTE revoked.
- The migration re-checks every public relation's ACL as a postcondition.

### Idempotency

Every step is guarded, so a rerun changes nothing:
- Legacy backfill runs only where a component has no report at any status.
- Seeded reports are skipped when the same parent, component, source and value already exist.
- Canonical changes apply only from their reviewed `from` value.
- Treatments apply only to UNKNOWN rows.
- The 2019-20 environment is created once and checked thereafter.
