const O="https://213.21.241.28/api/v1"; const r=await fetch(O+"/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:process.env.T_EMAIL,password:process.env.T_PW})}); const {accessToken:t}=await r.json();
const s=await (await fetch(O+"/materials/"+process.env.MAT_ID,{headers:{authorization:"Bearer "+t}})).text(); const j=JSON.parse(s);
console.log("total",s.length, "base64 data:", (s.match(/data:[a-z/+]+;base64,[A-Za-z0-9+/=]{200,}/g)||[]).map(x=>x.length));
const walk=(o,p,out)=>{ if(o&&typeof o==="object"){ for(const [k,v] of Object.entries(o)) walk(v,p+"."+k,out);} else if(typeof o==="string"&&o.length>2000) out.push([p,o.length]); return out; };
console.log(walk(j,"",[]).sort((a,b)=>b[1]-a[1]).slice(0,10));
const blocks=(j.material||j).blocks||j.content?.blocks||[]; const by={}; for(const b of blocks){ by[b.type]=(by[b.type]||0)+JSON.stringify(b).length;} console.log(blocks.length, by);
console.log(Object.keys(j), Object.keys(j.material||{}));
