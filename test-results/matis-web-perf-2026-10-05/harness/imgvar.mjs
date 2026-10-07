const O="https://213.21.241.28"; const r=await fetch(O+"/api/v1/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:process.env.T_EMAIL,password:process.env.T_PW})}); const {accessToken:t}=await r.json(); const H={authorization:"Bearer "+t};
const s=await (await fetch(O+"/api/v1/materials/"+process.env.MAT_ID,{headers:H})).text();
const ids=[...new Set([...s.matchAll(/"assetId":"([0-9a-f-]{36})"/g)].map(x=>x[1]))];
let a=0,b=0;
for (const id of ids) { const u=(await (await fetch(O+`/api/v1/assets/${id}/url`,{headers:H})).json()).url; if(!/\.(png|jpe?g|webp)\?/i.test(u)) continue;
  const o=(await (await fetch(O+u)).arrayBuffer()).byteLength; const t0=Date.now(); const w=(await (await fetch(O+u+"&v=web")).arrayBuffer()).byteLength; const ms=Date.now()-t0;
  a+=o; b+=w; console.log(u.split("?")[0].slice(-12), o, w, (w/o*100).toFixed(0)+"%", ms+"ms"); }
console.log("total", a, b, (b/a*100).toFixed(0)+"%");
