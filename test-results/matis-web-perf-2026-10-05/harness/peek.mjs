const O="https://213.21.241.28/api/v1"; const r=await fetch(O+"/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"methodist@school.dev",password:"password123"})}); const {accessToken:t}=await r.json();
const m=await (await fetch(O+"/materials/d39b26cd-633e-411f-ba45-3c191804db32",{headers:{authorization:"Bearer "+t}})).json();
const mat=m.material; console.log(JSON.stringify({...mat, blocks: undefined, groups: mat.groups?.slice?.(0,1)}).slice(0,800));
const f=mat.blocks.find(b=>b.type==="formula"); console.log(JSON.stringify(f));
const rt=mat.blocks.find(b=>b.type==="rich_text"); console.log(JSON.stringify(rt).slice(0,500));
console.log(mat.blocks.filter(b=>b.type==="rich_text" && JSON.stringify(b).includes("formula")).length);
