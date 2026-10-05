const O="https://213.21.241.28"; const r=await fetch(O+"/api/v1/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:process.env.T_EMAIL,password:process.env.T_PW})}); const {accessToken:t}=await r.json(); const H={authorization:"Bearer "+t};
const m=await (await fetch(O+"/api/v1/materials/"+process.env.MAT_ID,{headers:H})).json();
const s=JSON.stringify(m); const ids=[...new Set([...s.matchAll(/"(?:assetId|posterAssetId|imageAssetId)":"([0-9a-f-]{36})"/g)].map(x=>x[1]))];
console.log("assets", ids.length);
for (const id of ids) { const u=await (await fetch(O+`/api/v1/assets/${id}/url`,{headers:H})).json(); const url=u.url||u.signedUrl; if(!url){console.log(id,JSON.stringify(u).slice(0,100));continue;}
  const h=await fetch(O+url,{method:"GET"}); const b=Buffer.from(await h.arrayBuffer());
  let dim=""; if(b[1]===0x50&&b[2]===0x4e) dim=b.readUInt32BE(16)+"x"+b.readUInt32BE(20); else if(b.slice(8,12).toString()==="WEBP") dim="webp"; else if(b[0]===0xff&&b[1]===0xd8){ let i=2; while(i<b.length){ if(b[i]!==0xff)break; const mk=b[i+1], len=b.readUInt16BE(i+2); if(mk>=0xc0&&mk<=0xc2){dim=b.readUInt16BE(i+7)+"x"+b.readUInt16BE(i+5);break;} i+=2+len; } }
  console.log(id.slice(0,8), h.headers.get("content-type"), b.length, dim, h.headers.get("cache-control"), url.split("?")[0].slice(-12)); }
