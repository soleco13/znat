import { openBrowsers, P, finish, mark } from "./lib.mjs";
await openBrowsers(["teacher"]);
const T = P.teacher;
await T.goto(process.env.SITE + "/contacts");
mark("gl", await T.eval(`(() => { const r = {}; for (const f of [false, true]) { const c = document.createElement("canvas"); const g = c.getContext("webgl", { failIfMajorPerformanceCaveat: f }); r["caveat_" + f] = !!g; if (g) { const e = g.getExtension("WEBGL_debug_renderer_info"); r.renderer = e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); } } return r; })()`));
await finish();
