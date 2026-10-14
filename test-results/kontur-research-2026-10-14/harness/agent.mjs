// Управляемый браузер для исследования: HTTP API поверх CDP (eval, клик, скриншот, сохранение ответов сети).
import http from "node:http";
import fs from "node:fs";
import { connectBrowser, openPage, sleep } from "./cdp.mjs";
const OUT = process.env.OUT || "/out";
const logf = fs.createWriteStream(`${OUT}/events.jsonl`, { flags: "a" });
const log = (e) => logf.write(JSON.stringify({ t: Date.now(), ...e }) + "\n");
const browser = await connectBrowser(process.env.CDP);
const page = await openPage(browser, "kt", log);
// SDP и сигнальные кадры — для изучения настроек медиа.
await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  window.__sdp = [];
  const P = RTCPeerConnection.prototype;
  for (const m of ['setLocalDescription','setRemoteDescription']) { const o = P[m]; P[m] = function(d, ...a) { try { const x = d || this.pendingLocalDescription; window.__sdp.push({ t: Date.now(), m, type: x && x.type, sdp: x && x.sdp }); } catch {} return o.call(this, d, ...a); }; }
  const ac = P.addTransceiver; P.addTransceiver = function(t, init) { try { window.__sdp.push({ t: Date.now(), m: 'addTransceiver', kind: typeof t === 'string' ? t : t.kind, init: JSON.parse(JSON.stringify(init || {}, (k, v) => v instanceof MediaStream ? 'stream' : v)) }); } catch {} return ac.call(this, t, init); };
  const sp = RTCRtpSender.prototype.setParameters; RTCRtpSender.prototype.setParameters = function(p, ...a) { try { window.__sdp.push({ t: Date.now(), m: 'setParameters', kind: this.track && this.track.kind, p: JSON.parse(JSON.stringify(p)) }); } catch {} return sp.call(this, p, ...a); };
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = (c) => { window.__sdp.push({ t: Date.now(), m: 'getUserMedia', c: JSON.parse(JSON.stringify(c)) }); return gum(c); };
  const atc = MediaStreamTrack.prototype.applyConstraints; MediaStreamTrack.prototype.applyConstraints = function(c) { window.__sdp.push({ t: Date.now(), m: 'applyConstraints', kind: this.kind, c: JSON.parse(JSON.stringify(c || {})) }); return atc.call(this, c); };
})();` });
const wsFrames = [];
const bodies = new Map();
browser.listeners.set(page.sessionId, ((prev) => (method, p) => {
  prev(method, p);
  if (method === "Network.webSocketFrameSent" || method === "Network.webSocketFrameReceived") {
    const d = p.response.payloadData; log({ kind: method.endsWith("Sent") ? "wsout" : "wsin", id: p.requestId, op: p.response.opcode, len: d.length, data: p.response.opcode === 1 ? d.slice(0, 4000) : d.slice(0, 600) });
  }
  if (method === "Network.responseReceived") bodies.set(p.requestId, { url: p.response.url, mime: p.response.mimeType });
  if (method === "Network.loadingFinished") {
    const b = bodies.get(p.requestId);
    if (b && /javascript|json|wasm|css|html/.test(b.mime)) page.send("Network.getResponseBody", { requestId: p.requestId }).then((r) => {
      const name = b.url.replace(/^https?:\/\//, "").replace(/[?#].*$/, "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180);
      fs.mkdirSync(`${OUT}/files`, { recursive: true });
      fs.writeFileSync(`${OUT}/files/${name}`, r.base64Encoded ? Buffer.from(r.body, "base64") : r.body);
      log({ kind: "file", url: b.url.slice(0, 300), mime: b.mime, name });
    }).catch(() => {});
  }
})(browser.listeners.get(page.sessionId)));
http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  const u = new URL(req.url, "http://x");
  try {
    let out;
    if (u.pathname === "/eval") out = await page.eval(body, 60000);
    else if (u.pathname === "/goto") { await page.goto(body); out = "ok"; }
    else if (u.pathname === "/click") out = await page.click(body);
    else if (u.pathname === "/type") { await page.send("Input.insertText", { text: body }); out = "ok"; }
    else if (u.pathname === "/key") { for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: body, code: body, windowsVirtualKeyCode: body === "Enter" ? 13 : 0 }); out = "ok"; }
    else if (u.pathname === "/shot") { const r = await page.send("Page.captureScreenshot", { format: "png" }); fs.mkdirSync(`${OUT}/shots`, { recursive: true }); fs.writeFileSync(`${OUT}/shots/${body || "shot"}.png`, Buffer.from(r.data, "base64")); out = `${OUT}/shots/${body || "shot"}.png`; }
    else if (u.pathname === "/cdp") { const { m, p } = JSON.parse(body); out = await page.send(m, p); }
    res.end(JSON.stringify(out ?? null));
  } catch (e) { res.statusCode = 500; res.end(String(e.stack || e)); }
}).listen(8080, "0.0.0.0");
console.log("agent ready", browser.version);
