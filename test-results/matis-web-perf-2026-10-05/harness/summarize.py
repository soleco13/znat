import json, sys, glob, os, collections, gzip
DIST='/tmp/claude-0/-root/b01cf0b8-2a32-4d72-8e0f-020c427048fa/scratchpad/dist'
_c={}
def est(r):
    # CDP не даёт encodedDataLength для fetch()-докачки: берём фактический размер ответа
    if r.get('cache') or r.get('status')!=200 or not r.get('first'): return 0
    p=r['url'].split('?')[0].replace('https://213.21.241.28','')
    f=DIST+p
    if not os.path.isfile(f): return r.get('raw') or 0
    if p in _c: return _c[p]
    enc=r.get('enc') or ''
    if enc=='br' and os.path.isfile(f+'.br'): v=os.path.getsize(f+'.br')
    elif enc=='gzip': v=len(gzip.compress(open(f,'rb').read(),5))
    else: v=os.path.getsize(f)
    _c[p]=v+200; return v+200
def B(r):
    b=r.get('bytes') or 0
    if b==0 and not r.get('failed'): b=est(r)
    return b
D=os.path.join(os.path.dirname(__file__),"results")
def cat(r):
    u=r['url'].split('?')[0]; t=r.get('type'); m=r.get('mime') or ''
    if t=='Document' or m=='text/html': return 'html'
    if u.endswith(('.js','.mjs')) or 'javascript' in m: return 'js'
    if u.endswith('.css') or m=='text/css': return 'css'
    if t=='Font' or u.endswith(('.woff2','.woff','.ttf')): return 'font'
    if t=='Image' or m.startswith('image/'): return 'img'
    if t=='Media' or m.startswith(('video/','audio/')): return 'media'
    if '/api/' in u: return 'api'
    return 'other'
def summ(rows):
    s=collections.defaultdict(int); n=0
    for r in rows:
        if r.get('url','').endswith('/ping') or '/ping?' in r['url']: s['ping']+=B(r); continue
        b=B(r); s[cat(r)]+=b; n+=1
    s['total']=sum(v for k,v in s.items() if k!='ping'); s['n']=n; return s
prof=sys.argv[1] if len(sys.argv)>1 else 'none'
summary={x['label']:x for x in json.load(open(f"{D}/{prof}-summary.json"))} if os.path.exists(f"{D}/{prof}-summary.json") else {}
for f in sorted(glob.glob(f"{D}/{prof}-*.requests.json")):
    lab=f.split(prof+'-')[1].split('.')[0]; rows=json.load(open(f))
    seen=set()
    for r in rows:
        k=r['url'].split('?')[0] if '/assets/' in r['url'] or '/fonts/' in r['url'] else r['url']
        r['first']= k not in seen and not r.get('cache'); seen.add(k)
    phases=collections.OrderedDict()
    for r in rows: phases.setdefault(r['phase'],[]).append(r)
    print(f"\n### {lab}  {json.dumps(summary.get(lab,{}).get('m'))} {json.dumps(summary.get(lab,{}).get('extra'))}")
    allrows=[]
    T0=min(r['t0'] for r in rows)
    for ph,rs in phases.items():
        allrows+=rs; s=summ(rs)
        rel=[r for r in rs if '/ping' not in r['url'] and r.get('t1')]
        a=min(r['t0'] for r in rel)-T0 if rel else 0; b=max(r['t1'] for r in rel)-T0 if rel else 0
        st=[r for r in rel if '/assets/' in r['url'] or '/fonts/' in r['url'] or '/files/' in r['url']]
        bs=max(r['t1'] for r in st)-T0 if st else 0
        print(f"  [{ph:8}] start={a:6.1f}s  last-response={b:6.1f}s  last-static={bs:6.1f}s")
        print(f"  [{ph:8}] n={s['n']:3} html={s['html']/1024:7.1f}K js={s['js']/1024:7.1f}K css={s['css']/1024:6.1f}K img={s['img']/1024:7.1f}K font={s['font']/1024:6.1f}K api={s['api']/1024:6.1f}K media={s['media']/1024:7.1f}K other={s['other']/1024:6.1f}K TOTAL={s['total']/1024:8.1f}K ping={s['ping']}")
    s=summ(allrows); print(f"  [ALL     ] n={s['n']:3} js={s['js']/1024:.1f}K css={s['css']/1024:.1f}K img={s['img']/1024:.1f}K font={s['font']/1024:.1f}K TOTAL={s['total']/1024:.1f}K")
    if '-v' in sys.argv:
        for r in sorted(rows,key=lambda r:-B(r))[:int(os.environ.get('TOPN','25'))]:
            print(f"     {r['phase']:8} {cat(r):5} {B(r)/1024:8.1f}K raw={(r.get('raw') or 0)/1024:8.1f}K {r.get('enc','') or '-':5} {r.get('type'):10} {r.get('prio','')} {r['url'].replace('https://213.21.241.28','')[:90]}")
