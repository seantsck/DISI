    -- 052: a season with two or more organizations stays a research need unless exactly two organizations appear, every stint of the season is
    -- game-dated, and one canonical transaction of this player moves him from the first to the second inside that season with his last
    -- appearance for the first on or before the transaction date and his first for the second on or after it. A team change is never a
    -- transaction (TEAM CHANGE != CANONICAL TRANSACTION); the transaction date and the two appearance dates stay three facts.
    -- 053: the direction is the player's, read from his asset side (the ledger records every transaction from the Dodgers' side: an INCOMING
    -- player came from the counterparty to the Dodgers), and a transaction with one known end brackets the Dodgers boundary of the move: a
    -- Dodgers release, free agency or waiver without a counterparty after his last game for the Dodgers and before his first for the other club,
    -- or a Dodgers free-agent signing after his last game for the other club and before his first for the Dodgers. The other club's signing or
    -- release is not a Dodgers transaction and is never implied. Exactly one bracketing transaction closes the season; two or more stay open
    -- for a person to decide (lib/research/development-chronology.js mirrors this rule).
    -- 054: a move between two clubs other than the Dodgers is explained by career history (player_career_transactions), never by the Dodgers
    -- ledger: a direct move from the first club to the second (a trade, a waiver claim, a purchase), or the player leaving the first club and later
    -- joining the second (two facts: a release or a move to a third club, then a signing or a move from a third club), each between his last game
    -- for the first and his first for the second. The clubs are ordered by first appearance. Career history explains development chronology only:
    -- no asset, package, control-interval or value view reads it.
    exists (
      select 1
      from (
        select s.season from team_stints s
        where s.player_id = p.id and s.organization_id is not null
        group by s.season
        having count(distinct s.organization_id) >= 2
      ) ms
      cross join lateral (
        select
          (select s.organization_id from team_stints s join public.organizations o on o.id = s.organization_id
            where s.player_id = p.id and s.season = ms.season and s.organization_id is not null
            group by s.organization_id, o.name order by min(s.first_game_date), o.name limit 1) as org_a,
          (select s.organization_id from team_stints s join public.organizations o on o.id = s.organization_id
            where s.player_id = p.id and s.season = ms.season and s.organization_id is not null
            group by s.organization_id, o.name order by min(s.first_game_date), o.name offset 1 limit 1) as org_b
      ) ord0
      cross join lateral (
        select ord0.org_a, ord0.org_b,
          (select max(s.last_game_date) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = ord0.org_a) as last_a,
          (select min(s.first_game_date) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = ord0.org_b) as first_b
      ) ord
      where not (
        (select count(distinct s.organization_id) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id is not null) = 2
        and not exists (
          select 1 from team_stints s
          where s.player_id = p.id and s.season = ms.season and s.organization_id is not null
            and (s.first_game_date is null or s.last_game_date is null))
        and ((
          select count(distinct e.id)
          from public.transaction_event_assets a
          join public.transaction_events e on e.id = a.event_id
          cross join lateral (
            select case when a.asset_side = 'INCOMING' then e.to_organization_id else e.from_organization_id end as from_known,
                   case when a.asset_side = 'INCOMING' then e.from_organization_id else e.to_organization_id end as to_known
          ) k
          cross join lateral (
            select coalesce(k.from_known, (select s.organization_id from team_stints s where s.player_id = p.id and s.season = ms.season
                                             and s.organization_id is not null and s.organization_id <> k.to_known limit 1)) as from_org,
                   coalesce(k.to_known, (select s.organization_id from team_stints s where s.player_id = p.id and s.season = ms.season
                                           and s.organization_id is not null and s.organization_id <> k.from_known limit 1)) as to_org,
                   (k.from_known is null or k.to_known is null) as boundary
          ) mv
          where a.player_id = p.id
            and extract(year from e.transaction_date)::int = ms.season
            and e.from_organization_id is not null
            and k.from_known is distinct from k.to_known
            and (k.from_known is null or exists (select 1 from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = k.from_known))
            and (k.to_known is null or exists (select 1 from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = k.to_known))
            and (not mv.boundary
                 or (select min(s.first_game_date) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = mv.from_org)
                    <= (select min(s.first_game_date) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = mv.to_org))
            and (select max(s.last_game_date) from team_stints s
                 where s.player_id = p.id and s.season = ms.season and s.organization_id = mv.from_org) <= e.transaction_date
            and (select min(s.first_game_date) from team_stints s
                 where s.player_id = p.id and s.season = ms.season and s.organization_id = mv.to_org) >= e.transaction_date)
          + (select count(*) from public.player_career_transactions c
              where c.player_id = p.id and extract(year from c.transaction_date)::int = ms.season
                and c.from_organization_id = ord.org_a and c.to_organization_id = ord.org_b
                and c.transaction_date >= ord.last_a and c.transaction_date <= ord.first_b)
          + (select count(*) from public.player_career_transactions x
              join public.player_career_transactions y on y.player_id = x.player_id and y.id <> x.id
              where x.player_id = p.id and extract(year from x.transaction_date)::int = ms.season and extract(year from y.transaction_date)::int = ms.season
                and x.from_organization_id = ord.org_a and x.to_organization_id is distinct from ord.org_b
                and y.to_organization_id = ord.org_b and y.from_organization_id is distinct from ord.org_a
                and x.transaction_date >= ord.last_a and x.transaction_date <= ord.first_b
                and y.transaction_date >= ord.last_a and y.transaction_date <= ord.first_b
                and x.transaction_date <= y.transaction_date)
          ) = 1)
    ) as has_unverified_multi_org_season
