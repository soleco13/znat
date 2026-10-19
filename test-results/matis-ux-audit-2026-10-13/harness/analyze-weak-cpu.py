# Сводка прогонов s33-weak-cpu: задержка звука, дорисовка, замирания у s1 (b) и учителя (a). python3 analyze-weak-cpu.py ../data/<прогон> [-v]
import json,sys,statistics as st,re
def load(d):
    S=[json.loads(l) for l in open(d+'/samples.jsonl')]
    return [s for s in S if s['who']=='b'],[s for s in S if s['who']=='a']
def series(B,skip_s=30):
    t0=B[0]['t']; rows=[]
    for p,c in zip(B,B[1:]):
        if (c['t']-t0)/1000<skip_s: continue
        dt=(c['t']-p['t'])/1000
        pa={x['id']:x for x in p['inA']}; ca={x['id']:x for x in c['inA']}
        dl=[];conc=[]
        for k,v in ca.items():
            o=pa.get(k)
            if o and v['jbe']>o['jbe']: dl.append(1000*(v['jbd']-o['jbd'])/(v['jbe']-o['jbe']))
            if o and v['tot']>o['tot']: conc.append((v['conc']-o['conc'])/(v['tot']-o['tot']))
        pv={x['id']:x for x in p['inV']}; cv={x['id']:x for x in c['inV']}
        fz=fzd=fd=0
        for k,v in cv.items():
            o=pv.get(k)
            if o: fz+=(v['fz'] or 0)-(o['fz'] or 0); fzd+=(v['fzd'] or 0)-(o['fzd'] or 0); fd+=(v['fd'] or 0)-(o['fd'] or 0)
        rows.append(dict(t=(c['t']-t0)/1000,dt=dt,delay=max(dl) if dl else None,conc=max(conc) if conc else None,fz=fz,fzd=fzd,fps=fd/dt,h=max([v['h'] or 0 for v in cv.values()] or [0])))
    return rows
def summary(rows):
    d=[r['delay'] for r in rows if r['delay'] is not None]
    T=sum(r['dt'] for r in rows)/60
    def pct(a,q): a=sorted(a); return a[int(q*(len(a)-1))] if a else None
    return dict(min=round(T,1),delay_med=round(st.median(d)) if d else None,delay_p90=round(pct(d,.9)) if d else None,
      share_over300=round(sum(1 for x in d if x>300)/len(d),2) if d else None,
      conc_pct=round(100*st.mean([r['conc'] for r in rows if r['conc'] is not None]),2),
      freezes_per_min=round(sum(r['fz'] for r in rows)/T,1),freeze_s_per_min=round(sum(r['fzd'] for r in rows)/T,1),
      fps=round(st.mean(r['fps'] for r in rows),1),height=round(st.median(r['h'] for r in rows)))
for d in sys.argv[1:]:
    B,A=load(d); r=series(B)
    print(d.split('/')[-1],'s1:',summary(r),'| teacher:',summary(series(A)))
    if '-v' in sys.argv: 
        for x in r: print(x)
