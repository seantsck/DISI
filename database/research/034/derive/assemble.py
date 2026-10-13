#!/usr/bin/env python3
"""Assembles database/research/034/exit-seed.json from the Baseball-Reference team-year transaction pages (and the
official MLB transaction log for three 2009+ cases) that Phase 1 fetched one page at a time.

The raw pages are NOT committed (they live under the gitignored research-output/ scratch folders):

    python database/research/034/derive/assemble.py <raw-dir-1> [<raw-dir-2> ...]

Every asset identity comes from the link targets on the page line itself (a /players/ id is a Baseball-Reference major
league id, a /register/ id is a Register id); MLB ids come from the Baseball-Reference WAR data file (its mlb_ID column)
or the official log. Names are display fields only. Running it again over the same pages reproduces the same file.
"""
import csv
import datetime
import glob
import json
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'exit-seed.json')
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
RAW_WAR = os.path.join(ROOT, 'research-output', '032-work', 'raw')

fold = lambda s: ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c)).lower().strip()
dirs = sys.argv[1:] or [os.path.join(ROOT, 'research-output', '033-work', 'raw'), os.path.join(ROOT, 'research-output', '034-work', 'raw')]


def parse(fn):
    t = open(fn, encoding='utf-8', errors='replace').read()
    out = []
    for m in re.finditer(r'<li><span>([^<]+)</span>\s*<div>(.*?)</div>\s*</li>', t, re.S):
        label = m.group(1).strip()
        for p in re.findall(r'<p>(.*?)</p>', m.group(2), re.S):
            links = re.findall(r'<a href="([^"]+)">([^<]+)</a>', p)
            out.append((label, re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', p)).strip(), links))
    return out


PAGES = {}
for d in dirs:
    for fn in glob.glob(os.path.join(d, '*-tx.html')):
        PAGES[os.path.basename(fn)[:-8]] = parse(fn)

# mlb_ID by Baseball-Reference id, from the same WAR data file Migration 032/033 used
MLB = {}
for name in ('war_daily_bat.txt', 'war_daily_pitch.txt'):
    fn = os.path.join(RAW_WAR, name)
    if not os.path.exists(fn):
        continue
    with open(fn, encoding='utf-8', newline='') as fh:
        rd = csv.DictReader(fh)
        for r in rd:
            if r['mlb_ID'] and r['mlb_ID'] != 'NULL':
                MLB[r['player_ID']] = r['mlb_ID']


def ids_for(links, name):
    """Identity of `name` from the page line's link targets."""
    for href, text in links:
        if fold(text) != fold(name):
            continue
        m = re.match(r'/players/[a-z]/([a-z0-9]+)\.shtml', href)
        if m:
            return {'bref_id': m.group(1), 'bref_register_id': None}
        m = re.match(r'/register/player\.fcgi\?id=([a-z0-9-]+)', href)
        if m:
            return {'bref_id': None, 'bref_register_id': m.group(1)}
    return None


def find(page, label, must):
    for lab, text, links in PAGES.get(page, []):
        if lab == label and all(fold(x) in fold(text) for x in must):
            return text, links
    raise SystemExit(f'not found: {page} | {label} | {must}')


def url_for(page):
    team, year = page.split('-')[0], page.split('-')[1]
    return f'https://www.baseball-reference.com/teams/{team}/{year}-transactions.shtml'


def player(name, links, side, cp, **kw):
    ids = ids_for(links, name) or {}
    bref = kw.get('bref_id') or ids.get('bref_id')
    reg = kw.get('bref_register_id') or ids.get('bref_register_id')
    mlb = kw.get('mlb_id') or (MLB.get(bref) if bref else None)
    if not (bref or reg or mlb):
        raise SystemExit(f'no identity for {name}')
    return {'side': side, 'type': 'PLAYER', 'name': kw.get('display') or name, 'player_slug': None, 'mlb_id': mlb, 'bref_id': bref,
            'bref_register_id': reg, 'counterparty': cp, 'cash_amount_usd': None, 'pool_space_amount_usd': None, 'role_note': kw.get('note')}


def other(kind, name, side, cp, note=None):
    return {'side': side, 'type': kind, 'name': name, 'player_slug': None, 'mlb_id': None, 'bref_id': None, 'bref_register_id': None,
            'counterparty': cp, 'cash_amount_usd': None, 'pool_space_amount_usd': None, 'role_note': note}


EVENTS = []
RESOLUTIONS = []
ASSET_OBS = []
TIMING = []


def add(key, date, typ, label, from_org, to_org, description, src, assets, existing=False):
    EVENTS.append({'key': key, 'existing': existing, 'date': date, 'type': typ, 'historical_label': label, 'is_multi_team': False,
                   'from_org': from_org, 'to_org': to_org, 'description': description, 'source_url': src, 'assets': assets})


def trade(key, page, lab, date, frm, to, out_names, in_names, cash_out=False, cash_in=False, label=None, in_minors=()):
    text, links = find(page, lab, out_names + in_names)
    cp = to
    assets = [player(n, links, 'OUTGOING', cp) for n in out_names]
    if cash_out:
        assets.append(other('CASH', 'Cash', 'OUTGOING', cp))
    assets += [player(n, links, 'INCOMING', cp) for n in in_names]
    if cash_in:
        assets.append(other('CASH', 'Cash', 'INCOMING', cp))
    add(key, date, 'TRADE', label, frm, to, text, url_for(page), assets)
    return assets


def single(key, page, lab, date, typ, name, label, frm='LAD', incoming=False, cp=None):
    text, links = find(page, lab, [name])
    a = player(name, links, 'INCOMING' if incoming else 'OUTGOING', cp)
    add(key, date, typ, label, frm, None, text, url_for(page), [a])


# ---- first-hop return-asset exits (Phase 1) -----------------------------------------------------------------------------
trade('BRO_NYY_1957_BEN_FLOWERS', 'BRO-1957', 'May 24, 1957', '1957-05-24', 'BRO', 'NYY', ['Ben Flowers'], ['Jim Fridley'])
text, links = find('LAD-1958', 'Before 1959 Season', ['Elmer Valo'])
add('LAD_RELEASE_1958_ELMER_VALO', '1958-12-31', 'RELEASE', 'Released (Baseball-Reference: "Before 1959 Season"; exact date unknown, placed at the end of the 1958 season)',
    'LAD', None, text, url_for('LAD-1958'), [player('Elmer Valo', links, 'OUTGOING', None)])
text, links = find('LAD-1958', 'April 10, 1958', ['Jim Fridley'])
add('LAD_DET_1958_JIM_FRIDLEY', '1958-04-10', 'SALE', 'Player rights sold (Baseball-Reference: the date is approximate)', 'LAD', 'DET', text, url_for('LAD-1958'),
    [player('Jim Fridley', links, 'OUTGOING', 'DET')])
trade('LAD_NYM_1962_TIM_HARKNESS', 'LAD-1962', 'November 30, 1962', '1962-11-30', 'LAD', 'NYM', ['Larry Burright', 'Tim Harkness'], ['Bob Miller'])
single('LAD_FREE_AGENCY_1993_MIKE_SHARPERSON', 'LAD-1993', 'October 8, 1993', '1993-10-08', 'FREE_AGENCY', 'Mike Sharperson', 'Granted free agency')
single('LAD_FREE_AGENT_SIGNING_1994_MIKE_SHARPERSON', 'LAD-1994', 'February 23, 1994', '1994-02-23', 'FREE_AGENT_SIGNING', 'Mike Sharperson', 'Signed as a free agent', incoming=True)
single('LAD_RELEASE_1994_MIKE_SHARPERSON', 'LAD-1994', 'April 2, 1994', '1994-04-02', 'RELEASE', 'Mike Sharperson', 'Released')
trade('LAD_NYY_1996_BILLY_BREWER', 'LAD-1996', 'June 22, 1996', '1996-06-22', 'LAD', 'NYY', ['Billy Brewer'], ['Mike Judd'])
single('LAD_FREE_AGENCY_1996_DELINO_DESHIELDS', 'LAD-1996', 'October 29, 1996', '1996-10-29', 'FREE_AGENCY', 'Delino DeShields', 'Granted free agency')
trade('LAD_NYM_1998_GREG_MCMICHAEL', 'LAD-1998', 'July 10, 1998', '1998-07-10', 'LAD', 'NYM', ['Greg McMichael'], ['Brian Bohanon'], cash_out=True)
single('LAD_FREE_AGENCY_1998_BRIAN_BOHANON', 'LAD-1998', 'October 27, 1998', '1998-10-27', 'FREE_AGENCY', 'Brian Bohanon', 'Granted free agency')
trade('LAD_DET_1999_DAVE_MLICKI', 'LAD-1999', 'April 16, 1999', '1999-04-16', 'LAD', 'DET', ['Dave Mlicki', 'Mel Rojas'],
      ['Apostol Garcia', 'Rick Roberts', 'Robinson Checo'])
single('LAD_FREE_AGENCY_2000_TODD_HUNDLEY', 'LAD-2000', 'October 27, 2000', '2000-10-27', 'FREE_AGENCY', 'Todd Hundley', 'Granted free agency')
trade('LAD_TB_2001_MIKE_JUDD', 'LAD-2000', 'March 28, 2001', '2001-03-28', 'LAD', 'TB', ['Mike Judd'], [],
      label='Sent as part of a conditional deal (Baseball-Reference); no incoming consideration is recorded')
trade('LAD_CWS_2001_GARY_MAJEWSKI', 'LAD-2001', 'July 26, 2001', '2001-07-26', 'LAD', 'CWS', ['Jeff Barry', 'Gary Majewski', 'Onan Masaoka'], ['James Baldwin'],
      cash_in=True)
single('LAD_FREE_AGENCY_2001_JAMES_BALDWIN', 'LAD-2001', 'November 5, 2001', '2001-11-05', 'FREE_AGENCY', 'James Baldwin', 'Granted free agency')
single('LAD_FREE_AGENCY_2001_TERRY_ADAMS', 'LAD-2001', 'November 5, 2001', '2001-11-05', 'FREE_AGENCY', 'Terry Adams', 'Granted free agency')
trade('LAD_TOR_2001_CHAD_RICKETTS', 'LAD-2001', 'December 13, 2001', '2001-12-13', 'LAD', 'TOR', ['Chad Ricketts', 'Luke Prokopec'], ['César Izturis', 'Paul Quantrill'])
trade('LAD_WSH_2002_JORGE_NUNEZ', 'LAD-2002', 'March 23, 2002', '2002-03-23', 'LAD', 'WSH', ['Jorge Núñez', 'Matt Herges'], ['Guillermo Mota', 'Wilkin Ruan'])
trade('CHC_LAD_2002_TODD_HUNDLEY', 'LAD-2002', 'December 4, 2002', '2002-12-04', 'LAD', 'CHC', ['Mark Grudzielanek', 'Eric Karros'], ['Chad Hermansen', 'Todd Hundley'])
single('LAD_FREE_AGENCY_2003_PAUL_QUANTRILL', 'LAD-2003', 'October 30, 2003', '2003-10-30', 'FREE_AGENCY', 'Paul Quantrill', 'Granted free agency')
single('LAD_RELEASE_2003_CHAD_HERMANSEN', 'LAD-2003', 'November 20, 2003', '2003-11-20', 'RELEASE', 'Chad Hermansen', 'Released')
single('LAD_RELEASE_2004_WILKIN_RUAN', 'LAD-2004', 'June 19, 2004', '2004-06-19', 'RELEASE', 'Wilkin Ruan', 'Released')
trade('LAD_MIA_2004_GUILLERMO_MOTA', 'LAD-2004', 'July 30, 2004', '2004-07-30', 'LAD', 'MIA', ['Juan Encarnación', 'Paul Lo Duca', 'Guillermo Mota'],
      ['Hee-Seop Choi', 'Bill Murphy', 'Brad Penny'])
trade('LAD_ARI_2004_BILL_MURPHY', 'LAD-2004', 'July 31, 2004', '2004-07-31', 'LAD', 'ARI', ['Reggie Abercrombie', 'Koyie Hill', 'Bill Murphy'], ['Steve Finley', 'Brent Mayne'])
single('LAD_FREE_AGENCY_2004_TODD_HUNDLEY', 'LAD-2004', 'October 29, 2004', '2004-10-29', 'FREE_AGENCY', 'Todd Hundley', 'Granted free agency')
trade('LAD_ARI_2005_SHAWN_GREEN', 'LAD-2004', 'January 11, 2005', '2005-01-11', 'LAD', 'ARI', ['Shawn Green'],
      ['William Juárez', 'Danny Muegge', 'Dioner Navarro', 'Beltrán Pérez'])
text, links = find('LAD-2006', 'March 24, 2006', ['Hee-Seop Choi'])
add('LAD_WAIVER_2006_HEE_SEOP_CHOI', '2006-03-24', 'WAIVER', 'Selected off waivers by the Boston Red Sox', 'LAD', 'BOS', text, url_for('LAD-2006'),
    [player('Hee-Seop Choi', links, 'OUTGOING', 'BOS')])
# Navarro: the outgoing player to be named later was Justin Ruggiano (2006-07-19)
text, links = find('LAD-2006', 'June 27, 2006', ['Dioner Navarro', 'Toby Hall'])
a = [player('Dioner Navarro', links, 'OUTGOING', 'TB'), player('Jae Weong Seo', links, 'OUTGOING', 'TB'), other('PLAYER_TO_BE_NAMED', 'Player to be named later', 'OUTGOING', 'TB'),
     player('Justin Ruggiano', links, 'OUTGOING', 'TB', note='Completed the trade on 2006-07-19.'),
     player('Toby Hall', links, 'INCOMING', 'TB'), player('Mark Hendrickson', links, 'INCOMING', 'TB'), other('CASH', 'Cash', 'INCOMING', 'TB')]
add('LAD_TB_2006_DIONER_NAVARRO', '2006-06-27', 'TRADE', None, 'LAD', 'TB', text, url_for('LAD-2006'), a)
RESOLUTIONS.append({'event': 'LAD_TB_2006_DIONER_NAVARRO', 'placeholder': ['OUTGOING', 'Player to be named later'], 'resolved': ['OUTGOING', 'Justin Ruggiano'],
                    'date': '2006-07-19', 'source_url': url_for('LAD-2006'), 'confidence': 'VERIFIED',
                    'note': 'The Dodgers sent Justin Ruggiano on July 19, 2006 to complete the trade (Baseball-Reference 2006 Los Angeles Dodgers transactions).'})
trade('LAD_CHC_2006_CESAR_IZTURIS', 'LAD-2006', 'July 31, 2006', '2006-07-31', 'LAD', 'CHC', ['César Izturis'], ['Greg Maddux'])
single('LAD_FREE_AGENCY_2006_GREG_MADDUX', 'LAD-2006', 'October 31, 2006', '2006-10-31', 'FREE_AGENCY', 'Greg Maddux', 'Granted free agency')
single('LAD_FREE_AGENCY_2006_TOBY_HALL', 'LAD-2006', 'October 31, 2006', '2006-10-31', 'FREE_AGENCY', 'Toby Hall', 'Granted free agency')
trade('LAD_NYY_2007_WILSON_BETEMIT', 'LAD-2007', 'July 31, 2007', '2007-07-31', 'LAD', 'NYY', ['Wilson Betemit'], ['Scott Proctor'])
single('LAD_FREE_AGENCY_2007_MARK_HENDRICKSON', 'LAD-2007', 'December 12, 2007', '2007-12-12', 'FREE_AGENCY', 'Mark Hendrickson', 'Granted free agency')
# Maddux's second Dodgers interval: two players to be named later (Eduardo Perez and Mike Watt, 2008-09-30)
text, links = find('LAD-2008', 'August 19, 2008', ['Greg Maddux'])
a = [other('PLAYER_TO_BE_NAMED', 'Player to be named later #1', 'OUTGOING', 'SD'), other('PLAYER_TO_BE_NAMED', 'Player to be named later #2', 'OUTGOING', 'SD'),
     player('Eduardo Pérez', links, 'OUTGOING', 'SD', note='Completed the trade on 2008-09-30.'),
     player('Mike Watt', links, 'OUTGOING', 'SD', note='Completed the trade on 2008-09-30.'),
     player('Greg Maddux', links, 'INCOMING', 'SD')]
add('SD_LAD_2008_GREG_MADDUX', '2008-08-19', 'TRADE', None, 'LAD', 'SD', text, url_for('LAD-2008'), a)
for n, ph in (('Eduardo Pérez', 'Player to be named later #1'), ('Mike Watt', 'Player to be named later #2')):
    RESOLUTIONS.append({'event': 'SD_LAD_2008_GREG_MADDUX', 'placeholder': ['OUTGOING', ph], 'resolved': ['OUTGOING', n], 'date': '2008-09-30', 'source_url': url_for('LAD-2008'),
                        'confidence': 'VERIFIED', 'note': 'The Dodgers sent the player on September 30, 2008 to complete the trade (Baseball-Reference 2008 Los Angeles Dodgers transactions).'})
single('LAD_FREE_AGENCY_2008_GREG_MADDUX', 'LAD-2008', 'October 30, 2008', '2008-10-30', 'FREE_AGENCY', 'Greg Maddux', 'Granted free agency')
single('LAD_FREE_AGENCY_2008_CASEY_BLAKE', 'LAD-2008', 'October 30, 2008', '2008-10-30', 'FREE_AGENCY', 'Casey Blake', 'Granted free agency')
single('LAD_FREE_AGENT_SIGNING_2008_CASEY_BLAKE', 'LAD-2008', 'December 9, 2008', '2008-12-09', 'FREE_AGENT_SIGNING', 'Casey Blake', 'Signed as a free agent', incoming=True)
single('LAD_FREE_AGENCY_2008_BRAD_PENNY', 'LAD-2008', 'November 5, 2008', '2008-11-05', 'FREE_AGENCY', 'Brad Penny', 'Granted free agency')
single('LAD_FREE_AGENCY_2008_SCOTT_PROCTOR', 'LAD-2008', 'December 12, 2008', '2008-12-12', 'FREE_AGENCY', 'Scott Proctor', 'Granted free agency')

# ---- 2009+ cases from the official MLB transaction log (ids from the canonical 033 assets) ------------------------------
def api_event(key, date, typ, label, desc, mlb, bref, name, person):
    add(key, date, typ, label, 'LAD', None, desc, f'https://statsapi.mlb.com/api/v1/transactions?playerId={person}',
        [{'side': 'OUTGOING', 'type': 'PLAYER', 'name': name, 'player_slug': None, 'mlb_id': mlb, 'bref_id': bref, 'bref_register_id': None,
          'counterparty': None, 'cash_amount_usd': None, 'pool_space_amount_usd': None, 'role_note': None}])


api_event('LAD_RELEASE_2013_MIKE_ANTONINI', '2013-03-27', 'RELEASE', 'Released',
          'Albuquerque Isotopes (Los Angeles Dodgers affiliate) released LHP Michael Antonini.', '502103', None, 'Mike Antonini', '502103')
api_event('LAD_FREE_AGENCY_2019_JEDD_GYORKO', '2019-11-02', 'FREE_AGENCY', 'Elected free agency', '3B Jedd Gyorko elected free agency.', '576397', 'gyorkje01',
          'Jedd Gyorko', '576397')
api_event('LAD_FREE_AGENCY_2022_DAVID_PRICE', '2022-11-06', 'FREE_AGENCY', 'Elected free agency', 'LHP David Price elected free agency.', '456034', 'priceda01',
          'David Price', '456034')

# ---- asset observations -------------------------------------------------------------------------------------------------
OFFICIAL = 'https://statsapi.mlb.com/api/v1/transactions?playerId='
ASSET_OBS += [
    {'asset': {'event': 'LAD_BOS_2020_JETER_DOWNS', 'side': 'INCOMING', 'name': 'Mookie Betts'}, 'type': 'DODGERS_CONTROL_OBSERVED', 'observed_through': '2026-10-11',
     'confidence': 'HIGH', 'source_url': OFFICIAL + '605141', 'note': 'The official transaction log shows continued Dodgers activity and no exit through the date.'},
    {'asset': {'event': 'LAD_COL_2026_NICK_FRASSO', 'side': 'INCOMING', 'name': 'Seth Halvorsen'}, 'type': 'DODGERS_CONTROL_OBSERVED', 'observed_through': '2026-10-11',
     'confidence': 'HIGH', 'source_url': OFFICIAL + '678020', 'note': 'Optioned to Oklahoma City 2026-09-20; no exit through the date.'},
    {'asset': {'event': 'LAD_NYM_2026_CHAYCE_MCDERMOTT', 'side': 'INCOMING', 'name': 'Ben Rortvedt'}, 'type': 'DODGERS_CONTROL_OBSERVED', 'observed_through': '2026-10-11',
     'confidence': 'HIGH', 'source_url': OFFICIAL + '666163', 'note': 'Outrighted to Oklahoma City 2026-09-03; no exit through the date.'},
    {'asset': {'event': 'LAD_FREE_AGENT_SIGNING_2008_CASEY_BLAKE', 'side': 'INCOMING', 'name': 'Casey Blake'}, 'type': 'CAREER_ENDED_WITH_DODGERS', 'observed_through': '2026-10-11',
     'confidence': 'HIGH', 'source_url': url_for('LAD-2008'),
     'note': 'The last MLB team-season in the Baseball-Reference files (2011) is with the Dodgers; no exit transaction is recorded.'},
]

doc = {
    'generated_by': 'database/research/034/derive/assemble.py',
    'retrieved_at': '2026-10-11T00:00:00Z',
    'events': EVENTS,
    'resolutions': RESOLUTIONS,
    'asset_observations': ASSET_OBS,
    'not_seeded': [
        {'case': 'Ron Negray 1959-06-03', 'reason': 'Traded to a minor-league club (Toronto, International League) for "Error and Mike Goliat"; the counterparty is not a major-league organization and the incoming name is a page artifact. Not canonically supportable.'},
        {'case': 'Gail Harris, Greg Smith, Melvin Geho, Rick Clelland, Arnie Gooch, Brian Stephenson, Andre Simpson, Orlando Rodriguez',
         'reason': 'No source-backed exit transaction was found; absence is not an exit.'},
    ],
}
json.dump(doc, open(OUT, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print(len(EVENTS), 'events,', sum(len(e['assets']) for e in EVENTS), 'assets,', len(RESOLUTIONS), 'resolutions')
