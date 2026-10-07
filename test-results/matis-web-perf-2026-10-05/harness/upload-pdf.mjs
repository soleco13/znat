import fs from "node:fs";
const O="https://213.21.241.28/api/v1"; const r=await fetch(O+"/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:process.env.T_EMAIL,password:process.env.T_PW})}); const {accessToken:t}=await r.json();
const fd=new FormData(); fd.append("file", new Blob([fs.readFileSync("fixtures/perf-test.pdf")],{type:"application/pdf"}), "perf-test.pdf");
const u=await fetch(O+`/lessons/${process.env.LID}/uploads`,{method:"POST",headers:{authorization:"Bearer "+t},body:fd}); console.log(u.status, await u.text());
