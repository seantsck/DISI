import test from 'node:test'
import assert from 'node:assert/strict'
import { getResearchData, summarizeResearchTasks, describeError, logDetail, RESEARCH_TASK_TYPES, RESEARCH_TASK_LIMIT } from '../../lib/data.js'

// A recording stand-in for the Supabase client: every builder call is logged per request, `then` resolves the fixture for the
// relation (or an injected error) after a tick, and the number of requests in flight at once is tracked.
function fakeClient(fixtures, { errorFor = {} } = {}) {
  const requests = []
  let inFlight = 0
  let maxInFlight = 0
  const client = {
    requests,
    get maxInFlight() { return maxInFlight },
    from(relation) {
      const req = { relation, calls: [] }
      requests.push(req)
      const builder = new Proxy({}, {
        get(_, prop) {
          if (prop === 'then') {
            return (resolve, reject) => {
              inFlight += 1
              maxInFlight = Math.max(maxInFlight, inFlight)
              return new Promise((done) => setTimeout(done, 1)).then(() => {
                inFlight -= 1
                const error = errorFor[relation] ?? null
                return { data: error ? null : fixtures[relation], error }
              }).then(resolve, reject)
            }
          }
          return (...args) => { req.calls.push([prop, ...args]); return builder }
        },
      })
      return builder
    },
  }
  return client
}

// Database-ordered task rows (priority desc, signing_year asc, full_name asc nulls first), more than the 200 cap,
// including a task type the page does not list.
const taskRows = []
for (let i = 0; i < 400; i++) {
  const type = RESEARCH_TASK_TYPES[i % 5 === 0 ? 1 : i % 3 === 0 ? 2 : 6] // BWAR_MISSING, OUTCOME_AUDIT, ACQUISITION_COST_UNKNOWN
  taskRows.push({ task_type: type, priority: 3 - Math.floor(i / 100), signing_year: 2000 + (i % 25), full_name: `Player ${String(i).padStart(3, '0')}`, franchise_key: 'DODGERS' })
}
taskRows.push({ task_type: 'SOME_OTHER_TASK', priority: 0, signing_year: 2020, full_name: 'Other', franchise_key: 'DODGERS' })

const fixtures = {
  v_research_tasks: taskRows,
  v_class_research_coverage: [{ signing_year: 2024 }],
  source_tiers: [{ tier: 'A', priority: 1 }],
  v_dodgers_signing_population_coverage: [{ signing_year: 2024, population_scope: 'FULL_SIGNING_PERIOD' }],
  v_dodgers_class_source_reconciliation: [{ signing_year: 2022, unresolved_flag: true }],
  v_dodgers_signing_period_research_queue: [{ priority: 2 }],
  v_dodgers_outcome_audit_progress: { audited: 93 },
  v_dodgers_outcome_by_signing_class: [{ signing_year: 2015 }],
}

// What the previous implementation returned: one exact count per listed type, and a capped, database-ordered list per filter.
const expectedCounts = Object.fromEntries(RESEARCH_TASK_TYPES.map((t) => [t, taskRows.filter((r) => r.task_type === t).length]))
const expectedTasks = (type) => (type ? taskRows.filter((r) => r.task_type === type) : taskRows).slice(0, 200)

test('getResearchData: live result with every research section, tasks counted once and queried one at a time', async () => {
  const client = fakeClient(fixtures)
  const r = await getResearchData(undefined, client)
  assert.equal(r.live, true)
  assert.equal(r.error, null)
  assert.deepEqual(r.classes, fixtures.v_class_research_coverage)
  assert.deepEqual(r.tiers, fixtures.source_tiers)
  assert.deepEqual(r.populations, fixtures.v_dodgers_signing_population_coverage)
  assert.deepEqual(r.reconciliation, fixtures.v_dodgers_class_source_reconciliation)
  assert.deepEqual(r.periodQueue, fixtures.v_dodgers_signing_period_research_queue)
  assert.deepEqual(r.outcomeProgress, fixtures.v_dodgers_outcome_audit_progress)
  assert.deepEqual(r.outcomeClasses, fixtures.v_dodgers_outcome_by_signing_class)
  assert.deepEqual(r.tasks, expectedTasks(undefined))
  assert.equal(r.tasks.length, RESEARCH_TASK_LIMIT)
  assert.deepEqual(r.taskCounts, expectedCounts)

  // one request per relation, v_research_tasks exactly once; never more than one request in flight
  assert.deepEqual(client.requests.map((q) => q.relation).sort(), Object.keys(fixtures).sort())
  assert.equal(client.maxInFlight, 1)
  const tasks = client.requests.find((q) => q.relation === 'v_research_tasks')
  assert.deepEqual(tasks.calls, [
    ['select', '*'],
    ['eq', 'franchise_key', 'DODGERS'],
    ['order', 'priority', { ascending: false }],
    ['order', 'signing_year', { ascending: true }],
    ['order', 'full_name', { ascending: true, nullsFirst: true }],
  ])
  // the other queries keep their filters, orders and caps
  const recon = client.requests.find((q) => q.relation === 'v_dodgers_class_source_reconciliation')
  assert.ok(recon.calls.some((c) => c[0] === 'eq' && c[1] === 'unresolved_flag' && c[2] === true))
  assert.ok(recon.calls.some((c) => c[0] === 'limit' && c[1] === 200))
  assert.ok(client.requests.find((q) => q.relation === 'v_dodgers_signing_period_research_queue').calls.some((c) => c[0] === 'limit' && c[1] === 200))
  assert.ok(client.requests.find((q) => q.relation === 'v_class_research_coverage').calls.some((c) => c[0] === 'eq' && c[1] === 'franchise_key' && c[2] === 'DODGERS'))
  assert.ok(client.requests.find((q) => q.relation === 'v_dodgers_outcome_audit_progress').calls.some((c) => c[0] === 'maybeSingle'))
})

test('taskCounts are identical to one exact count per listed type, whatever the filter', async () => {
  for (const type of [undefined, ...RESEARCH_TASK_TYPES]) {
    const r = await getResearchData(type, fakeClient(fixtures))
    assert.deepEqual(r.taskCounts, expectedCounts, String(type))
    assert.deepEqual(Object.keys(r.taskCounts), RESEARCH_TASK_TYPES)
  }
  assert.equal(expectedCounts.SOME_OTHER_TASK, undefined) // unlisted types are not counted, as before
  assert.equal(expectedCounts.CLASS_MEMBERS_MISSING, 0) // a listed type with no rows counts 0
})

test('taskType filtering keeps database order and the 200 cap; an unknown type yields no tasks', async () => {
  for (const type of RESEARCH_TASK_TYPES) {
    const r = await getResearchData(type, fakeClient(fixtures))
    assert.deepEqual(r.tasks, expectedTasks(type), type)
    assert.ok(r.tasks.every((t) => t.task_type === type))
    assert.ok(r.tasks.length <= RESEARCH_TASK_LIMIT)
  }
  assert.equal((await getResearchData('ACQUISITION_COST_UNKNOWN', fakeClient(fixtures))).tasks.length, RESEARCH_TASK_LIMIT)
  assert.deepEqual(summarizeResearchTasks(taskRows, 'NOT_A_TYPE').tasks, [])
  assert.deepEqual(summarizeResearchTasks([], undefined), { tasks: [], taskCounts: Object.fromEntries(RESEARCH_TASK_TYPES.map((t) => [t, 0])) })
})

test('a statement timeout returns the empty shape and a safe public message, logging only sanitized fields', async () => {
  const logged = []
  const original = console.error
  console.error = (...args) => logged.push(args)
  try {
    const timeout = { code: '57014', message: 'canceling statement due to statement timeout', details: null, hint: null }
    const r = await getResearchData(undefined, fakeClient(fixtures, { errorFor: { v_dodgers_signing_period_research_queue: timeout } }))
    assert.equal(r.live, false)
    assert.equal(r.error, 'The database did not respond in time. Please try again shortly.')
    assert.deepEqual(r.tasks, [])
    assert.deepEqual(r.taskCounts, {})
    assert.equal(r.outcomeProgress, null)
    assert.equal(logged.length, 1)
    assert.match(logged[0][0], /research coverage fetch failed/)
    assert.deepEqual(logged[0][1], { code: '57014', message: 'canceling statement due to statement timeout' })
  } finally { console.error = original }
})

test('describeError never yields "[object Object]" or a raw database message', () => {
  const cases = [
    [{ code: '', message: '', details: '', hint: '' }, 'Live data could not be loaded.'], // a failed HEAD/count request has no body
    [{}, 'Live data could not be loaded.'],
    [{ message: { nested: true } }, 'Live data could not be loaded.'],
    [{ code: '42501', message: 'permission denied for view v_research_tasks' }, 'Live data could not be loaded. (error 42501)'],
    [{ code: 'PGRST301', message: 'JWT expired' }, 'Live data could not be loaded. (error PGRST301)'],
    [{ code: '57014', message: '' }, 'The database did not respond in time. Please try again shortly.'],
    [new Error('canceling statement due to statement timeout'), 'The database did not respond in time. Please try again shortly.'],
    [new Error('connect ECONNREFUSED 10.0.0.1:5432'), 'Live data could not be loaded.'],
    ['Supabase environment variables are missing.', 'Supabase environment variables are missing.'],
    [null, 'Unknown error.'],
  ]
  for (const [input, expected] of cases) {
    const out = describeError(input)
    assert.equal(out, expected, JSON.stringify(input))
    assert.equal(typeof out, 'string')
    assert.doesNotMatch(out, /\[object Object\]/)
  }
  const missing = describeError({ code: 'PGRST205', message: "Could not find the table 'public.v_research_tasks'" })
  assert.match(missing, /migration 017/i)
  assert.doesNotMatch(missing, /\[object Object\]|public\.v_research_tasks/)
})

test('logDetail keeps only string error fields for the server log', () => {
  assert.deepEqual(logDetail({ code: '57014', message: 'canceling statement due to statement timeout', details: null, hint: '' }), { code: '57014', message: 'canceling statement due to statement timeout' })
  assert.deepEqual(logDetail({}), { message: 'error object without message' })
  assert.deepEqual(logDetail('boom'), { message: 'boom' })
})
