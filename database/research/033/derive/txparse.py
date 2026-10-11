import re,glob,json,datetime
def parse(fn):
    t=open(fn,encoding='utf-8',errors='replace').read()
    out=[]
    for m in re.finditer(r'<li><span>([^<]+)</span>\s*<div>(.*?)</div>\s*</li>',t,re.S):
        label=m.group(1).strip(); body=m.group(2)
        for p in re.findall(r'<p>(.*?)</p>',body,re.S):
            links=re.findall(r'<a href="([^"]+)">([^<]+)</a>',p)
            text=re.sub(r'<[^>]+>','',p)
            out.append((label,text,links))
    return out
def todate(label):
    try: return datetime.datetime.strptime(label,'%B %d, %Y').date().isoformat()
    except: return None
ALL={}
for fn in glob.glob('raw/*-tx.html'):
    ALL[fn.split('/')[-1][:-8]]=parse(fn)
if __name__=='__main__':
    u=json.load(open('universe2.json'))
    for e in u:
        if e['date']<'2009':
            hits=[]
            for pg,rows in ALL.items():
                for label,text,links in rows:
                    if todate(label)==e['date']: hits.append((pg,text,links))
            print('==',e['key'],e['date'])
            for h in hits: print('   ',h[0],'|',h[1][:230])
