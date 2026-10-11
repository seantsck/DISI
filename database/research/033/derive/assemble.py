"""Assembles event-seed.json for Migration 033 from the Phase 1/1B scratch artifacts.

Inputs (all under research-output/033-work/):
  universe2.json        141 tracked-player exit events (Phase 1B)
  lad-tr-rows.json      official MLB log, every Dodgers trade row 2009-2026 (person ids per transaction)
  player-logs.json      official per-player logs for the 220 tracked signings
  return-logs*.json     official per-player logs for first-hop return assets (re-fetched during implementation)
  raw/*-tx.html         Baseball-Reference team-year transaction pages (pre-2009 identities and wording)
  ../032-work/raw       Baseball-Reference WAR data files (id mapping only)
"""
import json, re, csv, unicodedata, collections, datetime, sys
sys.path.insert(0, '.')
from txparse import ALL, todate

def fold(s):
    s = unicodedata.normalize('NFKD', s)
    return ''.join(c for c in s if not unicodedata.combining(c)).lower().replace('.', '').replace("'", '').strip()

U = json.load(open('universe2.json'))
ROWS = json.load(open('lad-tr-rows.json'))
PLOGS = json.load(open('player-logs.json'))
D = {d['slug']: d for d in json.loads(open('disi-players.json', encoding='utf8').read().replace('},\n{', '},{'))}
RL = {}
for fn in ('return-logs.json', 'return-logs2.json', 'return-logs3.json'):
    RL.update(json.load(open(fn)))
INC = {x['name']: x for x in json.load(open('incoming.json'))}

# --- WAR file id maps ---
bref2mlb, mlb2bref = {}, {}
for fn in ('war_daily_bat.txt', 'war_daily_pitch.txt'):
    with open('../032-work/raw/' + fn, encoding='utf8') as f:
        for r in csv.DictReader(f):
            bref2mlb[r['player_ID']] = r['mlb_ID']
            mlb2bref.setdefault(r['mlb_ID'], r['player_ID'])

ORG = {'MON': 'WSH', 'KCR': 'KC', 'CHW': 'CWS', 'TB': 'TB'}
ORG_NAME = {'BRO': 'Brooklyn Dodgers', 'LAD': 'Los Angeles Dodgers', 'PIT': 'Pittsburgh Pirates', 'PHI': 'Philadelphia Phillies', 'DET': 'Detroit Tigers', 'TOR': 'Toronto Blue Jays',
            'CHC': 'Chicago Cubs', 'WSH': 'Montreal Expos / Washington Nationals', 'KC': 'Kansas City Royals', 'COL': 'Colorado Rockies', 'ARI': 'Arizona Diamondbacks',
            'NYM': 'New York Mets', 'CWS': 'Chicago White Sox', 'ATL': 'Atlanta Braves', 'CLE': 'Cleveland Indians', 'TB': 'Tampa Bay Rays', 'HOU': 'Houston Astros',
            'CIN': 'Cincinnati Reds', 'BAL': 'Baltimore Orioles', 'NYY': 'New York Yankees', 'MIN': 'Minnesota Twins', 'STL': 'St. Louis Cardinals', 'BOS': 'Boston Red Sox',
            'TEX': 'Texas Rangers', 'MIL': 'Milwaukee Brewers'}
def org(a):
    return ORG.get(a, a)

existing_keys = {'LAD_HOU_2016_YORDAN_ALVAREZ': 'LAD_HOU_2016_ALVAREZ_FIELDS', 'LAD_PIT_2017_ONEIL_CRUZ': 'LAD_PIT_2017_CRUZ_WATSON', 'LAD_BAL_2018_YUSNIEL_DIAZ': 'LAD_BAL_2018_DIAZ_MACHADO'}

# transaction rows by (date) -> list of rows (2009+ trades)
rows_by_date = collections.defaultdict(list)
for r in ROWS:
    rows_by_date[r['date']].append(r)

def row_person(name, date):
    n = fold(name)
    for r in rows_by_date.get(date, []):
        p = r.get('person')
        if p and fold(p.get('fullName', '')) == n:
            return str(p['id'])
    return None

def row_desc(date, anchor):
    """player-less (team level) row description for the transaction containing the anchor name"""
    best = None
    for r in rows_by_date.get(date, []):
        if 'person' not in r and fold(anchor) in fold(r['description']):
            best = r['description']
    if best is None:
        for r in rows_by_date.get(date, []):
            if fold(anchor) in fold(r['description']):
                best = r['description']
                break
    return best

# pre-2009 B-Ref paragraph for the event
def bref_para(date, anchor):
    n = fold(anchor).split()[-1]
    for pg, rws in ALL.items():
        for label, text, links in rws:
            if todate(label) == date and n in fold(text) and re.search(r'Traded|selected|drafted|Released|Free Agency', text):
                return pg, text.strip(), links
    return None

def link_ids(links):
    out = {}
    for h, t in links:
        if '/teams/' in h:
            continue
        if 'register/player.fcgi?id=' in h:
            out[fold(t)] = ('register', h.split('id=')[1])
        else:
            out[fold(t)] = ('bref', h.split('/')[-1].replace('.shtml', ''))
    return out

sources = {}  # url -> dict
def add_source(url, name, title, stype, tier, notes=None):
    if url not in sources:
        sources[url] = dict(url=url, source_name=name, title=title, source_type=stype, source_tier=tier, notes=notes)
    return url

def log_source(mlb, who):
    return add_source('https://statsapi.mlb.com/api/v1/transactions?playerId=%s' % mlb, 'MLB Stats API', 'MLB transaction history: %s' % who, 'MLB_TRANSACTION_LOG', 'MLB_TRANSACTION_LOG')

def bref_page(pg):
    team, year = pg.split('\\')[-1].split('-')[:2]
    url = 'https://www.baseball-reference.com/teams/%s/%s-transactions.shtml' % (team, year)
    return add_source(url, 'Baseball-Reference', '%s %s team transactions' % (year, 'Brooklyn Dodgers' if team == 'BRO' else 'Los Angeles Dodgers'), 'TRANSACTIONS', 'BASEBALL_REFERENCE')

def pick_page(date, anchor):
    yr = date[:4]
    hit = bref_para(date, anchor)
    # prefer the page for the event's own year
    for pg, rws in ALL.items():
        if pg.split('\\')[-1].endswith('-' + yr):
            for label, text, links in rws:
                if todate(label) == date and fold(anchor).split()[-1] in fold(text):
                    return pg, text.strip(), links
    return hit

def mk(side, kind, name, **kw):
    a = dict(side=side, type=kind, name=name, player_slug=None, mlb_id=None, bref_id=None, bref_register_id=None, counterparty=None, cash_amount_usd=None,
             pool_space_amount_usd=None, role_note=None)
    a.update(kw)
    return a

events = []
resolutions = []
observations = []   # asset observations
player_obs = []     # tracked-player observations

def finish_player(a, ids_by_name, date):
    """fill mlb/bref/register ids for a PLAYER asset"""
    n = fold(a['name'])
    if a['player_slug']:
        d = D[a['player_slug']]
        a['mlb_id'] = d['mlb_id']
        if d.get('bref_id'):
            a['bref_id'] = d['bref_id']
        return
    kind = ids_by_name.get(n)
    if kind:
        if kind[0] == 'register':
            a['bref_register_id'] = kind[1]
        else:
            a['bref_id'] = kind[1]
            a['mlb_id'] = bref2mlb.get(kind[1])
    if a['mlb_id'] is None and date >= '2009':
        m = row_person(a['name'], date)
        if m:
            a['mlb_id'] = m
    if a['mlb_id'] and a['bref_id'] is None and a['mlb_id'] in mlb2bref:
        a['bref_id'] = mlb2bref[a['mlb_id']]

NAME_FIX = {'Michael Antonini': 'Mike Antonini'}

for e in U:
    key = existing_keys.get(e['key'], e['key'])
    date = e['date']
    typ = e['type']
    cps = [org(c) for c in e['counterparties']]
    first_out = e['out'][0]['name'] if e['out'] else None
    ev = dict(key=key, existing=key in existing_keys.values(), date=date, type=typ, historical_label=e.get('hist'), is_multi_team=bool(e.get('multi')),
              from_org='BRO' if date < '1958-01-01' else 'LAD', to_org=cps[0] if cps else None, description=None, source_url=None, assets=[], tracked=e['tracked'])
    ids_by_name = {}
    if date < '2009':
        res = pick_page(date, first_out if typ != 'FREE_AGENCY' else first_out)
        # FA / drafts on B-Ref pages
        if res is None:
            res = bref_para(date, first_out)
        pg, text, links = res
        ids_by_name = link_ids(links)
        ev['description'] = re.sub(r'\s+', ' ', text)
        ev['source_url'] = bref_page(pg)
        if typ == 'FREE_AGENCY':
            ev['historical_label'] = 'Granted free agency'
        elif typ == 'RELEASE':
            ev['historical_label'] = 'Released'
    else:
        slug0 = e['tracked'][0] if e['tracked'] else None
        mlb0 = D[slug0]['mlb_id'] if slug0 else None
        if typ == 'TRADE':
            ev['description'] = row_desc(date, first_out) or row_desc(date, e['inc'][0]['name'] if e['inc'] else first_out)
        else:
            # non-trade rows are in the tracked player's own log
            rows = [r for r in PLOGS[slug0] if r['date'] == date]
            pref = [r for r in rows if r['typeCode'] in ('REL', 'DFA', 'CLW', 'SFA')] or rows
            ev['description'] = pref[0]['description'] if pref else None
            ev['historical_label'] = {'RELEASE': 'Released', 'FREE_AGENCY': 'Elected free agency', 'WAIVER': 'Claimed off waivers'}.get(typ)
        ev['source_url'] = log_source(mlb0, D[slug0]['full_name']) if slug0 else None
    for side, items in (('OUTGOING', e['out']), ('INCOMING', e['inc'])):
        for a in items:
            kind = a['kind']
            name = NAME_FIX.get(a['name'], a['name'])
            if kind == 'PLAYER_TO_BE_NAMED':
                name = 'Player to be named later'
            asset = mk(side, kind, name, player_slug=a.get('slug'), cash_amount_usd=a.get('amount') if kind == 'CASH' else None)
            if kind == 'PLAYER':
                finish_player(asset, ids_by_name, date)
            if kind == 'CASH' and date < '1958-01-01' and name == 'Draft price':
                asset['name'] = 'Draft price'
            events_cp = cps
            asset['counterparty'] = events_cp[0] if events_cp and typ in ('TRADE', 'RULE5_SELECTION', 'EXPANSION_DRAFT') else None
            ev['assets'].append(asset)
    # tracked outgoing players: attach the DISI identity
    for t in e['tracked']:
        full = fold(D[t]['full_name'])
        cand = [a for a in ev['assets'] if a['side'] == 'OUTGOING' and a['type'] == 'PLAYER' and fold(a['name']) == full]
        if not cand:
            toks = full.split()
            cand = [a for a in ev['assets'] if a['side'] == 'OUTGOING' and a['type'] == 'PLAYER' and toks[0] in fold(a['name']) and toks[-1] in fold(a['name'])]
        if len(cand) != 1:
            if ev['key'] in existing_keys.values() or e['type'] != 'TRADE':
                cand = [a for a in ev['assets'] if a['player_slug'] == t] or cand
        assert len(cand) == 1, (ev['key'], t, [a['name'] for a in ev['assets']])
        cand[0]['player_slug'] = t
        cand[0]['mlb_id'] = D[t]['mlb_id']
        if D[t].get('bref_id'):
            cand[0]['bref_id'] = D[t]['bref_id']
    events.append(ev)

# --- fixups on the Phase 1B events ---
def ev_by_key(k):
    return [x for x in events if x['key'] == k][0]
def asset(ev, side, name):
    return [a for a in ev['assets'] if a['side'] == side and a['name'] == name][0]

# multi-team 2024-07-29
v = ev_by_key('LAD_CWS_2024_JERAL_PEREZ')
v['is_multi_team'] = True
for a in v['assets']:
    a['counterparty'] = 'STL' if a['name'] in ('Tommy Edman', 'Oliver Gonzalez') else 'CWS'
for a in v['assets']:
    if a['type'] == 'PLAYER_TO_BE_NAMED':
        a['name'] = 'Player to be named later or cash considerations'
v['description'] = ROWS and row_desc('2024-07-29', 'Miguel Vargas')

# Chico Fernandez cash, Clemente cash
asset(ev_by_key('BRO_PHI_1957_FERNANDEZ'), 'INCOMING', 'Cash')['cash_amount_usd'] = 75000
cl = ev_by_key('BRO_PIT_1954_CLEMENTE_RULE5')
cl['historical_label'] = 'minor-league ("Rule 5") draft'
cl['from_org'] = 'BRO'
for a in cl['assets']:
    if a['type'] == 'CASH':
        a['name'] = 'Draft price'
        a['cash_amount_usd'] = 4000
asset(ev_by_key('LAD_ARI_1997_GARCIA_EXPANSION'), 'OUTGOING', 'Karim Garcia')['counterparty'] = 'ARI'

# Boston 2012 PTBNL placeholders: neutral names; resolved players stay as their own assets
bos = ev_by_key('BOS_LAD_2012_GONZALEZ_BECKETT_CRAWFORD')
for a in bos['assets']:
    if a['type'] == 'PLAYER_TO_BE_NAMED':
        a['name'] = 'Player to be named later #1' if 'De La Rosa' in a['name'] else 'Player to be named later #2'
# the asset name in universe was 'Player to be named later' already normalized by the loop above -> reassign explicitly
ph = [a for a in bos['assets'] if a['type'] == 'PLAYER_TO_BE_NAMED']
assert len(ph) == 2, ph
ph[0]['name'], ph[1]['name'] = 'Player to be named later #1', 'Player to be named later #2'
resolutions.append(dict(event=bos['key'], placeholder=('OUTGOING', 'Player to be named later #1'), resolved=('OUTGOING', 'Rubby De La Rosa'), date='2012-10-04',
                        source_url=log_source(D['rubby-de-la-rosa']['mlb_id'], D['rubby-de-la-rosa']['full_name']), confidence='VERIFIED',
                        note='Named by the Dodgers to complete the 2012-08-25 trade with Boston.'))
resolutions.append(dict(event=bos['key'], placeholder=('OUTGOING', 'Player to be named later #2'), resolved=('OUTGOING', 'Jerry Sands'), date='2012-10-04',
                        source_url=log_source(D['rubby-de-la-rosa']['mlb_id'], D['rubby-de-la-rosa']['full_name']), confidence='VERIFIED',
                        note='Named by the Dodgers to complete the 2012-08-25 trade with Boston.'))
# which placeholder is which is not distinguished by the source; the two are interchangeable and recorded as a pair
bos['description'] = row_desc('2012-08-25', 'Adrian Gonzalez')

fer = ev_by_key('BRO_PHI_1957_FERNANDEZ')
resolutions.append(dict(event=fer['key'], placeholder=('INCOMING', 'Player to be named later'), resolved=('INCOMING', 'Ben Flowers'), date='1957-04-08',
                        source_url=fer['source_url'], confidence='VERIFIED', note='The Phillies sent Ben Flowers on April 8, 1957 to complete the trade (Baseball-Reference 1957 Brooklyn transactions).'))
# Ben Flowers is an incoming PLAYER asset named after the placeholder
fl = asset(fer, 'INCOMING', 'Ben Flowers')
fl['bref_id'] = 'flowebe01'
fl['mlb_id'] = bref2mlb['flowebe01']
fl['role_note'] = 'Named 1957-04-08 to complete the trade; the placeholder asset is preserved.'
# the PHI page names Geho (minors) with a register id
val = ev_by_key('LAD_CHC_1999_VALDEZ')
page = pick_page('1999-12-12', 'Ismael Valdez')
lk = link_ids(page[2])
st = mk('INCOMING', 'PLAYER', 'Brian Stephenson', bref_register_id=lk['brian stephenson'][1], counterparty='CHC',
        role_note='Named 1999-12-16 to complete the trade (Baseball-Reference LAD 1999 transactions); the placeholder asset is preserved.')
val['assets'].append(st)
resolutions.append(dict(event=val['key'], placeholder=('INCOMING', 'Player to be named later'), resolved=('INCOMING', 'Brian Stephenson'), date='1999-12-16',
                        source_url=val['source_url'], confidence='HIGH', note='The Cubs sent Brian Stephenson (minors) on December 16, 1999 to complete the trade.'))
val['description'] = re.sub(r'\s+', ' ', page[1])

# Frias PTBNL and Vargas PTBNL-or-cash and Valdez 1999 (now resolved) -- all other placeholders stay unresolved.

# ---- first-hop return-asset exit events (20) ----
def ret_log(name):
    return RL[name]

def exit_event(key, date, typ, hist, name, who, mlb, bref, desc, src_mlb, src_who):
    a = mk('OUTGOING', 'PLAYER', who, mlb_id=str(mlb), bref_id=bref)
    return dict(key=key, existing=False, date=date, type=typ, historical_label=hist, is_multi_team=False, from_org='LAD', to_org=None, description=desc,
                source_url=log_source(src_mlb, src_who), assets=[a], tracked=[], return_exit=True)

RET = []
def fa(key, date, name, mlb, bref, logname):
    rows = [r for r in ret_log(logname)['rows'] if r['date'] == date and r['typeCode'] == 'DFA']
    RET.append(exit_event(key, date, 'FREE_AGENCY', 'Elected free agency', logname, name, mlb, bref, rows[0]['description'], mlb, name))
def rel(key, date, name, mlb, bref, logname):
    rows = [r for r in ret_log(logname)['rows'] if r['date'] == date and r['typeCode'] == 'REL']
    ev = exit_event(key, date, 'RELEASE', 'Released', logname, name, mlb, bref, rows[0]['description'], mlb, name)
    RET.append(ev)

fa('LAD_FREE_AGENCY_2014_JOSH_BECKETT', '2014-10-30', 'Josh Beckett', 277417, 'beckejo02', 'Beckett')
fa('LAD_FREE_AGENCY_2015_JOEL_PERALTA', '2015-11-07', 'Joel Peralta', 407908, 'peraljo01', 'Peralta')
fa('LAD_FREE_AGENCY_2017_TONY_WATSON', '2017-11-02', 'Tony Watson', 453265, 'watsoto01', 'Watson')
fa('LAD_FREE_AGENCY_2018_MANNY_MACHADO', '2018-10-29', 'Manny Machado', 592518, 'machama01', 'Machado')
fa('LAD_FREE_AGENCY_2019_RUSSELL_MARTIN', '2019-10-31', 'Russell Martin', 431145, 'martiru01', 'Martin')
fa('LAD_FREE_AGENCY_2021_MAX_SCHERZER', '2021-11-03', 'Max Scherzer', 453286, 'scherma01', 'Scherzer')
fa('LAD_FREE_AGENCY_2022_TREA_TURNER', '2022-11-06', 'Trea Turner', 607208, 'turnetr01', 'Turner')
fa('LAD_FREE_AGENCY_2024_JACK_FLAHERTY', '2024-10-31', 'Jack Flaherty', 656427, 'flaheja01', 'Flaherty')
fa('LAD_FREE_AGENCY_2025_MICHAEL_KOPECH', '2025-11-02', 'Michael Kopech', 656629, 'kopecmi01', 'Kopech')
fa('LAD_FREE_AGENCY_2026_ALEK_THOMAS', '2026-09-29', 'Alek Thomas', 677950, 'thomaal01', 'Thomas')
rel('LAD_RELEASE_2016_CARL_CRAWFORD', '2016-06-13', 'Carl Crawford', 408307, 'crawfca02', 'Crawford')
rel('LAD_RELEASE_2018_ADAM_LIBERATORE', '2018-09-05', 'Adam Liberatore', 571893, 'liberad01', 'Liberatore')
rel('LAD_RELEASE_2019_JOSH_FIELDS', '2019-03-10', 'Josh Fields', 451661, 'fieldjo03', 'Fields')
rel('LAD_RELEASE_2024_MOISES_BRITO', '2024-08-05', 'Moises Brito', 804975, None, 'Brito')
# Brito's release was by the Dodgers' Rancho Cucamonga affiliate

def trade_event(key, tx_id, date, out_names, in_names, cp, cash_out=False, cash_in=False, fc_in=False, anchor=None):
    rows = [r for r in ROWS if r['id'] == tx_id]
    pers = {fold(r['person']['fullName']): r for r in rows if 'person' in r}
    desc = [r['description'] for r in rows if 'person' not in r] or [rows[0]['description']]
    assets = []
    def pl(side, nm):
        r = pers[fold(nm)]
        mlb = str(r['person']['id'])
        a = mk(side, 'PLAYER', nm, mlb_id=mlb, bref_id=mlb2bref.get(mlb), counterparty=cp)
        return a
    for n in out_names:
        assets.append(pl('OUTGOING', n))
    if cash_out:
        assets.append(mk('OUTGOING', 'CASH', 'Cash', counterparty=cp))
    for n in in_names:
        assets.append(pl('INCOMING', n))
    if cash_in:
        assets.append(mk('INCOMING', 'CASH', 'Cash', counterparty=cp))
    if fc_in:
        assets.append(mk('INCOMING', 'FUTURE_CONSIDERATIONS', 'Future considerations', counterparty=cp))
    src_mlb = [a for a in assets if a['side'] == 'OUTGOING' and a['type'] == 'PLAYER'][0]['mlb_id']
    return dict(key=key, existing=False, date=date, type='TRADE', historical_label=None, is_multi_team=False, from_org='LAD', to_org=cp, description=desc[0],
                source_url=log_source(src_mlb, out_names[0]), assets=assets, tracked=[], return_exit=True)

RET.append(trade_event('LAD_ATL_2017_ADRIAN_GONZALEZ', 338884, '2017-12-16', ['Adrian Gonzalez', 'Scott Kazmir', 'Brandon McCarthy', 'Charlie Culberson'], ['Matt Kemp'], 'ATL', cash_out=True))
RET.append(trade_event('LAD_STL_2019_TONY_CINGRANI', 420985, '2019-07-31', ['Tony Cingrani', 'Jeffry Abreu'], ['Jedd Gyorko'], 'STL', cash_in=True, fc_in=True))
RET.append(trade_event('LAD_BOS_2020_JETER_DOWNS', 438093, '2020-02-10', ['Alex Verdugo', 'Connor Wong', 'Jeter Downs'], ['Mookie Betts', 'David Price'], 'BOS', cash_in=True))
RET.append(trade_event('LAD_TEX_2021_BILLY_MCKINNEY', 600521, '2021-11-22', ['Billy McKinney', 'Zach Reks'], [], 'TEX', cash_in=True))
RET.append(trade_event('LAD_COL_2026_NICK_FRASSO', 929102, '2026-07-20', ['Nick Frasso', 'Landyn Vidourek'], ['Seth Halvorsen'], 'COL'))
RET.append(trade_event('LAD_NYM_2026_CHAYCE_MCDERMOTT', 934271, '2026-08-03', ['Chayce McDermott'], ['Ben Rortvedt'], 'NYM'))
# Cingrani 2019 event: the "cash" and "Future Considerations" belong to the Dodgers' incoming side (STL to LAD)
for e in RET:
    if e['key'] == 'LAD_STL_2019_TONY_CINGRANI':
        pass
events.extend(RET)

# bref ids for outgoing return assets that were set explicitly
for e in events:
    for a in e['assets']:
        if a['type'] == 'PLAYER' and a['mlb_id'] and a['bref_id'] is None and a['mlb_id'] in mlb2bref:
            a['bref_id'] = mlb2bref[a['mlb_id']]

# ---- explicit identities for incoming players that the step above could not resolve ----
for e in events:
    for a in e['assets']:
        if a['type'] != 'PLAYER' or a['player_slug']:
            continue
        i = INC.get(a['name']) or INC.get(NAME_FIX and {v: k for k, v in NAME_FIX.items()}.get(a['name'], ''))
        if i and a['bref_id'] is None and i.get('pid'):
            a['bref_id'] = i['pid']
            a['mlb_id'] = a['mlb_id'] or bref2mlb.get(i['pid']) or i.get('mlb')

# Phase 1B ids confirmed by the official log person ids
EXTRA_MLB = {'Mike Antonini': '502103', 'Oliver Gonzalez': '823860', 'Noah Miller': '695653', 'Jose Vasquez': '807833', 'Moises Brito': '804975'}
for e in events:
    for a in e['assets']:
        if a['type'] == 'PLAYER' and a['name'] in EXTRA_MLB:
            if a['mlb_id'] is None:
                a['mlb_id'] = EXTRA_MLB[a['name']]
            assert a['mlb_id'] == EXTRA_MLB[a['name']], (a['name'], a['mlb_id'])

# Jerry Sands (named 2012-10-04) from the official log person ids
for d_, desc_, trk_, ids_ in json.load(open('events-2009.json')):
    if d_ == '2012-10-04':
        for pid, nm_ in ids_.items():
            for e in events:
                for a in e['assets']:
                    if a['type'] == 'PLAYER' and fold(a['name']) == fold(nm_) and a['mlb_id'] is None:
                        a['mlb_id'] = pid
                        if pid in mlb2bref and a['bref_id'] is None:
                            a['bref_id'] = mlb2bref[pid]

# Sanity: key uniqueness
keys = [e['key'] for e in events]
assert len(keys) == len(set(keys)), [k for k, n in collections.Counter(keys).items() if n > 1]

# ---- observations ----
def A(ev_key, side, name):
    return dict(event=ev_key, side=side, name=name)

def inc_asset(name):
    for e in events:
        for a in e['assets']:
            if a['side'] == 'INCOMING' and a['type'] == 'PLAYER' and a['name'] == name:
                return e, a
    raise KeyError(name)

OBS_THROUGH_LOGS = '2026-10-11'
def api_stats_source(mlb, who):
    return add_source('https://statsapi.mlb.com/api/v1/people/%s/stats?stats=career&group=hitting,pitching&gameType=R' % mlb, 'MLB Stats API',
                      'MLB career regular-season statistics: %s' % who, 'MLB_PERSON_RECORD', 'MLB_TRANSACTION_LOG')
for nm in ('Noah Miller', 'Jose Vasquez', 'Oliver Gonzalez', 'Moises Brito', 'Mike Antonini'):
    e, a = inc_asset(nm)
    observations.append(dict(asset=A(e['key'], 'INCOMING', nm), type='NO_MLB_APPEARANCE_OBSERVED', observed_through=OBS_THROUGH_LOGS, confidence='VERIFIED',
                             source_url=api_stats_source(a['mlb_id'], nm),
                             note='The official MLB career regular-season statistics for this person are empty; observed through the retrieval date. This is not a claim the player will never appear.'))
# register-only minor leaguers
for nm, ev_key in (('Melvin Geho', 'BRO_PHI_1957_FERNANDEZ'), ('Rick Clelland', 'LAD_MON_1995_DAAL'), ('Arnie Gooch', 'LAD_NYM_1998_CEDENO_HUNDLEY'), ('Jorge Nunez', 'LAD_TOR_1999_MONDESI_GREEN'),
                   ('Chad Ricketts', 'LAD_CHC_1999_VALDEZ'), ('Brian Stephenson', 'LAD_CHC_1999_VALDEZ'), ('Orlando Rodriguez', 'LAD_CHW_2001_OSUNA'), ('Andre Simpson', 'LAD_CHW_2001_OSUNA')):
    e, a = inc_asset(nm)
    rid = a['bref_register_id']
    url = add_source('https://www.baseball-reference.com/register/player.fcgi?id=%s' % rid, 'Baseball-Reference', 'Baseball-Reference Register: %s' % nm, 'MINOR_LEAGUE_PLAYER_PAGE', 'BASEBALL_REFERENCE')
    observations.append(dict(asset=A(e['key'], 'INCOMING', nm), type='NO_MLB_APPEARANCE_OBSERVED', observed_through=OBS_THROUGH_LOGS, confidence='HIGH', source_url=url,
                             note='Baseball-Reference carries only a minor-league Register record (no major-league player page) for this player; observed through the retrieval date.'))

# control observations for return assets
LOGSRC = {'Tommy Edman': 669242, 'Oliver Gonzalez': 823860, 'Noah Miller': 695653, 'Jose Vasquez': 807833, 'Alex Call': 669743, 'Nick Punto': 346857, 'Homer Bailey': 456701}
for nm in ('Tommy Edman', 'Oliver Gonzalez', 'Noah Miller', 'Jose Vasquez', 'Alex Call'):
    e, a = inc_asset(nm)
    observations.append(dict(asset=A(e['key'], 'INCOMING', nm), type='DODGERS_CONTROL_OBSERVED', observed_through=OBS_THROUGH_LOGS, confidence='VERIFIED',
                             source_url=log_source(LOGSRC[nm], nm), note='The official transaction log shows 2026 Dodgers-organization activity and no exit.'))
for nm, how in (('Nick Punto', 'Oakland Athletics signed free agent 2B Nick Punto on 2013-11-13; no Dodgers exit transaction appears in the official log.'),
                ('Homer Bailey', 'Kansas City Royals signed free agent RHP Homer Bailey on 2019-02-09; no Dodgers exit transaction appears in the official log.')):
    e, a = inc_asset(nm)
    observations.append(dict(asset=A(e['key'], 'INCOMING', nm), type='EXIT_MECHANISM_UNRECORDED', observed_through=OBS_THROUGH_LOGS, confidence='HIGH',
                             source_url=log_source(LOGSRC[nm], nm), note=how))
bat_url = 'https://www.baseball-reference.com/data/war_daily_bat.txt'
pit_url = 'https://www.baseball-reference.com/data/war_daily_pitch.txt'
for nm, last, comp in (('Ron Negray', 1958, 'pitch'), ('Greg Smith', 1991, 'pitch'), ('Todd Hundley', 2003, 'bat'), ('Casey Blake', 2011, 'bat')):
    e, a = inc_asset(nm)
    observations.append(dict(asset=A(e['key'], 'INCOMING', nm), type='CAREER_ENDED_WITH_DODGERS', observed_through='2026-09-28', confidence='MEDIUM',
                             source_url=bat_url if comp == 'bat' else pit_url,
                             note='The last major-league team-season in the Baseball-Reference WAR data files is with the Dodgers (%d); the exit mechanism is unrecorded.' % last))

# tracked-player observations (still controlled / history unavailable)
cat = json.load(open('cat159.json'))
res = json.load(open('res.json'))
exit_slugs = set(s for e in events for s in e['tracked'])
still = set(cat['STILL_WITH_DODGERS'])
noev = set(cat['NO_EXIT_EVIDENCE'])
unavailable = {'julian-leon', 'lenix-osuna'}
assert 'lenix-osuna' in D and 'julian-leon' in D
all_slugs = set(D)
rest = all_slugs - exit_slugs
# every non-exit player is classified exactly once
cls = {}
for s in rest:
    if s in unavailable: cls[s] = 'HISTORY_UNAVAILABLE'
    elif s in still: cls[s] = 'STILL_DODGERS_CONTROLLED'
    elif s in noev: cls[s] = 'NO_EXIT_EVIDENCE'
    else: cls[s] = '??'
cnt = collections.Counter(cls.values())
print('partition', len(exit_slugs), dict(cnt))
assert cnt['??'] == 0, [s for s, c in cls.items() if c == '??']
for s in sorted(rest):
    if cls[s] in ('STILL_DODGERS_CONTROLLED', 'HISTORY_UNAVAILABLE'):
        player_obs.append(dict(slug=s, type=cls[s], observed_through='2026-10-10',
                               source_url=log_source(D[s]['mlb_id'], D[s]['full_name']), confidence='VERIFIED' if cls[s] == 'STILL_DODGERS_CONTROLLED' else 'LOW',
                               note=('Official transaction log shows 2026 activity under a Dodgers-parent organization and no exit.' if cls[s] == 'STILL_DODGERS_CONTROLLED'
                                     else 'The official transaction log does not establish whether Dodgers control ended; no exit was inferred.')))

out = dict(events=events, resolutions=resolutions, asset_observations=observations, player_observations=player_obs, sources=sorted(sources.values(), key=lambda s: s['url']),
           partition=dict(left=len(exit_slugs), **dict(cnt)))
json.dump(out, open('event-seed.json', 'w'), indent=1)
n_assets = sum(len(e['assets']) for e in events)
print('events', len(events), collections.Counter(e['type'] for e in events))
print('assets', n_assets, collections.Counter(a['type'] for e in events for a in e['assets']))
print('PLAYER assets by side', collections.Counter((a['side']) for e in events for a in e['assets'] if a['type'] == 'PLAYER'))
print('resolutions', len(resolutions), 'asset_obs', len(observations), collections.Counter(o['type'] for o in observations), 'player_obs', len(player_obs))
print('sources', len(sources))
