import { Http } from "./lib.mjs";
const h = new Http("t"); const r = await h.req("POST", "/auth/login", { email: process.env.T_EMAIL, password: process.env.T_PW }); h.bearer = r.json.accessToken;
for (const src of ["", "?source=platform"]) {
  const m = await h.req("GET", "/materials" + src);
  for (const it of m.json?.items || []) {
    const full = await h.req("GET", `/materials/${it.id}`);
    const blocks = full.json?.material?.blocks || full.json?.blocks || full.json?.content?.blocks || [];
    const qs = blocks.filter((b) => b.type === "question").map((b) => b.interaction?.type);
    console.log(src || "own", it.id, JSON.stringify(it.title), qs.length, [...new Set(qs)].join(","));
  }
}
