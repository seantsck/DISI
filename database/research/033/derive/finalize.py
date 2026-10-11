"""Turns the assembled scratch seed (research-output/033-work/event-seed.json) into the committed
database/research/033/event-seed.json: ASCII asset names, per-asset sources for the facts that come from Baseball-Reference rather than the
official log (the Boston 2012 cash and players to be named later), the observation type vocabulary, deterministic ordering.

    python database/research/033/derive/finalize.py        # run from the repository root
"""
import json, unicodedata

def ascii_fold(s):
    s = unicodedata.normalize('NFKD', s)
    return ''.join(c for c in s if not unicodedata.combining(c))

s = json.load(open('research-output/033-work/event-seed.json'))
b12 = 'https://www.baseball-reference.com/teams/LAD/2012-transactions.shtml'
s['sources'].append(dict(url=b12, source_name='Baseball-Reference', title='2012 Los Angeles Dodgers team transactions', source_type='TRANSACTIONS',
                         source_tier='BASEBALL_REFERENCE', notes=None))
for e in s['events']:
    for a in e['assets']:
        a['name'] = ascii_fold(a['name'])
        if a['player_slug'] and not a['role_note']:
            a['role_note'] = 'DISI tracked international signing.'
        if e['key'] == 'BOS_LAD_2012_GONZALEZ_BECKETT_CRAWFORD' and a['type'] in ('CASH', 'PLAYER_TO_BE_NAMED'):
            a['source_url'] = b12
    e.pop('return_exit', None)
for r in s['resolutions']:
    r['placeholder'] = [r['placeholder'][0], ascii_fold(r['placeholder'][1])]
    r['resolved'] = [r['resolved'][0], ascii_fold(r['resolved'][1])]
    r.pop('source_url2', None)
for o in s['asset_observations']:
    o['asset']['name'] = ascii_fold(o['asset']['name'])
for o in s['player_observations']:
    if o['type'] == 'STILL_DODGERS_CONTROLLED':
        o['type'] = 'DODGERS_CONTROL_OBSERVED'
s['events'].sort(key=lambda e: (e['date'], e['key']))
for e in s['events']:
    e['assets'].sort(key=lambda a: (0 if a['side'] == 'OUTGOING' else 1, a['type'], a['name']))
seen = {}
for x in s['sources']:
    seen[x['url']] = x
s['sources'] = sorted(seen.values(), key=lambda x: x['url'])
s['resolutions'].sort(key=lambda r: (r['date'], r['event'], r['placeholder'][1]))
s['asset_observations'].sort(key=lambda o: (o['asset']['event'], o['asset']['name'], o['type']))
s['player_observations'].sort(key=lambda o: (o['slug'], o['type']))
json.dump(s, open('database/research/033/event-seed.json', 'w'), indent=1)
print(len(s['events']), 'events', len(s['sources']), 'sources')
