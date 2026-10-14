// Read-only checks for the staged, plan-bounded views (Migrations 043a, 044, 045).
//
// Each query returns the NUMBER OF VIOLATIONS (expected 0). A staged view is a thin security_invoker wrapper over a read-only (STABLE)
// PL/pgSQL function with invoker rights and a fixed empty search_path, executable by the API roles that read the view and not by
// PUBLIC; and no function the API roles can execute may write (VOLATILE) or run with its owner's rights (SECURITY DEFINER).
// `loaded` says whether 043a exists; the 044 and 045 pairs are checked once their views exist. Once the 045a serving layer exists
// (`serving`), the staged functions are internal: the API roles must NOT be able to execute them.

export const STAGED_FUNCTION_CHECK_NAMES = ['staged_function_violations', 'staged_view_wrapper_violations']

const PAIRS = `(values
    ('v_player_realized_organizational_value', 'disi_player_realized_organizational_value'),
    ('v_player_expected_organizational_value', 'disi_player_expected_organizational_value'),
    ('v_expected_value_research_queue', 'disi_expected_value_research_queue'),
    ('v_portfolio_candidate_readiness', 'disi_portfolio_candidate_readiness'),
    ('v_executive_overview', 'disi_executive_overview'),
    ('v_research_roadmap', 'disi_research_roadmap')
  ) as p(view_name, fn)`

/** name -> SQL returning one row { n } = number of violations. */
export const stagedFunctionQueries = (loaded, serving = false) => {
  if (!loaded) return Object.fromEntries(STAGED_FUNCTION_CHECK_NAMES.map((name) => [name, 'select 0::int as n']))
  return {
    // each present staged view's function: PL/pgSQL, STABLE, invoker rights, search_path fixed, no PUBLIC execute, anon + authenticated
    // execute; and no API-executable disi_ function is VOLATILE or SECURITY DEFINER
    staged_function_violations: `with expected as (
        select p.* from ${PAIRS}
        join pg_class c on c.relname = p.view_name and c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
      )
      select (
        (select count(*) from expected e
          left join pg_proc f on f.proname = e.fn and f.pronamespace = 'public'::regnamespace and f.pronargs = 0
          where f.oid is null
             or f.prolang <> (select oid from pg_language where lanname = 'plpgsql')
             or f.provolatile <> 's' or f.prosecdef
             or not (coalesce(f.proconfig, array[]::text[]) @> array['search_path=""'])
             or has_function_privilege('public', f.oid, 'EXECUTE')
             or has_function_privilege('anon', f.oid, 'EXECUTE') <> ${serving ? 'false' : 'true'}
             or has_function_privilege('authenticated', f.oid, 'EXECUTE') <> ${serving ? 'false' : 'true'})
      + (select count(*) from pg_proc f
          where f.pronamespace = 'public'::regnamespace and f.proname like 'disi\\_%'
            and (has_function_privilege('anon', f.oid, 'EXECUTE') or has_function_privilege('authenticated', f.oid, 'EXECUTE'))
            and (f.provolatile = 'v' or f.prosecdef))
      )::int as n`,

    // each present staged view is security_invoker and its rewrite rule depends on its function (the view is the function's wrapper)
    staged_view_wrapper_violations: `select count(*)::int as n
      from ${PAIRS}
      join pg_class c on c.relname = p.view_name and c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
      where coalesce(array_to_string(c.reloptions, ','), '') !~ 'security_invoker=(true|on)'
         or not exists (select 1 from pg_rewrite rw join pg_depend d on d.objid = rw.oid
                        join pg_proc f on f.oid = d.refobjid and f.proname = p.fn and f.pronamespace = 'public'::regnamespace
                        where rw.ev_class = c.oid)`,
  }
}

export const STAGED_FUNCTION_QUERIES = stagedFunctionQueries(true)
