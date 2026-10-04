// Минимальный CDP-клиент на встроенном WebSocket Node 22 + сбор событий страницы.
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const now = () => Date.now();

// Подмешивается до загрузки страницы: только наблюдение за RTCPeerConnection
// (список PC + смены состояний), код приложения не меняется.
export const LKDEBUG = `(() => { try { if (location.protocol !== 'https:') return; for (const n of ['livekit','livekit-room','livekit-participant','livekit-track','livekit-track-publication','livekit-engine','livekit-signal','livekit-pc-manager','livekit-pc-transport']) localStorage.setItem('loglevel:' + n, 'DEBUG'); } catch {} })();`;

export const INSTRUMENT = `(() => {
  if (window.__pcs) return;
  const pcs = []; const ev = [];
  window.__pcs = pcs; window.__pcEvents = ev;
  const Orig = window.RTCPeerConnection;
  if (!Orig) return;
  function P(...a) {
    const pc = new Orig(...a); const id = pcs.length; pcs.push(pc);
    const log = (type, v) => { ev.push({ t: Date.now(), pc: id, type, v }); if (ev.length > 2000) ev.splice(0, 500); };
    log('created', null);
    pc.addEventListener('connectionstatechange', () => log('conn', pc.connectionState));
    pc.addEventListener('iceconnectionstatechange', () => log('ice', pc.iceConnectionState));
    pc.addEventListener('signalingstatechange', () => log('sig', pc.signalingState));
    pc.addEventListener('icegatheringstatechange', () => log('gather', pc.iceGatheringState));
    return pc;
  }
  P.prototype = Orig.prototype;
  Object.setPrototypeOf(P, Orig);
  window.RTCPeerConnection = P;
  window.__collect = async () => {
    const out = [];
    for (let i = 0; i < pcs.length; i++) {
      const pc = pcs[i];
      const base = { pc: i, conn: pc.connectionState, ice: pc.iceConnectionState, gather: pc.iceGatheringState, sig: pc.signalingState };
      if (pc.connectionState === 'closed') { out.push(base); continue; }
      let st; try { st = await pc.getStats(); } catch (e) { base.err = String(e); out.push(base); continue; }
      const rep = {}; st.forEach((r) => { rep[r.id] = r; });
      const inbound = [], outbound = []; let pair = null, transport = null;
      for (const r of Object.values(rep)) {
        if (r.type === 'inbound-rtp') inbound.push({ kind: r.kind, ssrc: r.ssrc, mid: r.mid, trackIdentifier: r.trackIdentifier,
          packetsReceived: r.packetsReceived, packetsLost: r.packetsLost, bytesReceived: r.bytesReceived, jitter: r.jitter,
          framesDecoded: r.framesDecoded, framesPerSecond: r.framesPerSecond, frameWidth: r.frameWidth, frameHeight: r.frameHeight,
          freezeCount: r.freezeCount, totalFreezesDuration: r.totalFreezesDuration, framesDropped: r.framesDropped,
          audioLevel: r.audioLevel, totalAudioEnergy: r.totalAudioEnergy, totalSamplesReceived: r.totalSamplesReceived, concealedSamples: r.concealedSamples,
          nackCount: r.nackCount, pliCount: r.pliCount, jitterBufferDelay: r.jitterBufferDelay, jitterBufferEmittedCount: r.jitterBufferEmittedCount });
        if (r.type === 'outbound-rtp') outbound.push({ kind: r.kind, ssrc: r.ssrc, rid: r.rid, mid: r.mid, active: r.active,
          packetsSent: r.packetsSent, bytesSent: r.bytesSent, framesEncoded: r.framesEncoded, framesPerSecond: r.framesPerSecond,
          frameWidth: r.frameWidth, frameHeight: r.frameHeight, qualityLimitationReason: r.qualityLimitationReason,
          retransmittedPacketsSent: r.retransmittedPacketsSent, nackCount: r.nackCount, pliCount: r.pliCount,
          remote: r.remoteId && rep[r.remoteId] ? { rtt: rep[r.remoteId].roundTripTime, lost: rep[r.remoteId].packetsLost, fractionLost: rep[r.remoteId].fractionLost, jitter: rep[r.remoteId].jitter } : null });
        if (r.type === 'transport') transport = r;
      }
      const pairId = transport && transport.selectedCandidatePairId;
      const p = pairId ? rep[pairId] : Object.values(rep).find((r) => r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded');
      if (p) {
        const l = rep[p.localCandidateId] || {}, rr = rep[p.remoteCandidateId] || {};
        pair = { rtt: p.currentRoundTripTime, outBw: p.availableOutgoingBitrate, inBw: p.availableIncomingBitrate, state: p.state,
          local: l.candidateType + '/' + (l.protocol || '') + (l.relayProtocol ? '/' + l.relayProtocol : ''), remote: rr.candidateType + '/' + (rr.protocol || '') + ':' + (rr.port || ''),
          bytesSent: p.bytesSent, bytesReceived: p.bytesReceived };
      }
      out.push({ ...base, dtls: transport && transport.dtlsState, pair, inbound, outbound });
    }
    return out;
  };
  window.__videos = () => [...document.querySelectorAll('video')].map((v) => {
    const tile = v.closest('[data-lk-participant-identity],[data-lk-source]');
    const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : {};
    const track = v.srcObject && v.srcObject.getVideoTracks ? v.srcObject.getVideoTracks()[0] : null;
    return { source: v.getAttribute('data-lk-source') || (tile && tile.getAttribute('data-lk-source')),
      identity: tile && tile.getAttribute('data-lk-participant-identity'), local: v.getAttribute('data-lk-local-participant'),
      w: v.videoWidth, h: v.videoHeight, ready: v.readyState, paused: v.paused, t: v.currentTime,
      frames: q.totalVideoFrames, dropped: q.droppedVideoFrames, trackState: track && track.readyState, muted: track && track.muted,
      visible: v.getBoundingClientRect().width > 0 };
  });
})();`;

export async function connectBrowser(host) {
  const ver = await (await fetch(`http://${host}/json/version`)).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 1;
  const pending = new Map();
  const listeners = new Map(); // sessionId -> fn(method, params)
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) {
      const p = pending.get(m.id);
      if (p) { pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    } else if (m.method) {
      const fn = listeners.get(m.sessionId || "");
      if (fn) fn(m.method, m.params);
    }
  };
  ws.onclose = () => { for (const p of pending.values()) p.rej(new Error("cdp closed")); };
  const call = (method, params = {}, sessionId, timeoutMs = 30000) =>
    new Promise((res, rej) => {
      const id = seq++;
      const timer = setTimeout(() => { pending.delete(id); rej(new Error(`cdp timeout ${method}`)); }, timeoutMs);
      pending.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  return { ws, call, listeners, version: ver.Browser };
}

/** Страница + журнал событий (консоль, исключения, сеть, WS). */
export async function openPage(browser, name, log, browserContextId) {
  const { targetId } = await browser.call("Target.createTarget", { url: "about:blank", ...(browserContextId ? { browserContextId } : {}) });
  const { sessionId } = await browser.call("Target.attachToTarget", { targetId, flatten: true });
  const send = (m, p, t) => browser.call(m, p, sessionId, t);
  const wsUrls = new Map();
  const wsFrames = new Map();
  const reqs = new Map();
  browser.listeners.set(sessionId, (method, p) => {
    switch (method) {
      case "Runtime.consoleAPICalled":
        if (process.env.LKDEBUG && (p.type === "debug" || p.type === "log" || p.type === "info")) {
          const text = p.args.map((a) => a.value ?? (a.preview ? JSON.stringify(Object.fromEntries((a.preview.properties || []).map((x) => [x.name, x.value]))) : a.description) ?? "").join(" ").slice(0, 600);
          log({ who: name, kind: "console.debug", text, quiet: true });
        }
        if (p.type === "error" || p.type === "warning") {
          const text = p.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 400);
          log({ who: name, kind: p.type === "error" ? "console.error" : "console.warn", text });
        }
        break;
      case "Runtime.exceptionThrown":
        log({ who: name, kind: "exception", text: (p.exceptionDetails.exception?.description || p.exceptionDetails.text || "").slice(0, 400) });
        break;
      case "Log.entryAdded":
        if (p.entry.level === "error") log({ who: name, kind: "browser.log", text: `${p.entry.source}: ${p.entry.text}`.slice(0, 400), url: p.entry.url });
        break;
      case "Network.requestWillBeSent": {
        const u = p.request.url;
        reqs.set(p.requestId, { url: u, method: p.request.method, t0: Date.now(), type: p.type });
        if (u.includes("/api/v1/telemetry") && p.request.postData) {
          try { for (const e of JSON.parse(p.request.postData).events || []) log({ who: name, kind: "tele", type: e.event, ts: e.ts, extra: e.fields, quiet: true }); } catch {}
        }
        break;
      }
      case "Network.loadingFinished": {
        const r = reqs.get(p.requestId);
        if (r && (r.url.includes("/api/") || r.url.includes("/files/")) && !r.url.includes("/telemetry")) {
          log({ who: name, kind: "rest", method: r.method, url: r.url.replace(/^https?:\/\/[^/]+/, "").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id").slice(0, 90), status: r.status, ms: Date.now() - r.t0, bytes: p.encodedDataLength, quiet: true });
        }
        reqs.delete(p.requestId);
        break;
      }
      case "Network.responseReceived": {
        const s = p.response.status;
        { const r = reqs.get(p.requestId); if (r) r.status = s; }
        if (s >= 400) log({ who: name, kind: s >= 500 ? "http5xx" : "http4xx", status: s, url: p.response.url.slice(0, 200), method: reqs.get(p.requestId)?.method });
        break;
      }
      case "Network.loadingFailed":
        if (!p.canceled) { const r = reqs.get(p.requestId); log({ who: name, kind: "net.fail", text: p.errorText, url: (r?.url || "").slice(0, 200), method: r?.method, ms: r ? Date.now() - r.t0 : null, type: p.type }); }
        reqs.delete(p.requestId);
        break;
      case "Network.webSocketCreated":
        wsUrls.set(p.requestId, p.url);
        wsFrames.set(p.requestId, 0);
        log({ who: name, kind: "ws.created", url: shortWs(p.url) });
        break;
      case "Network.webSocketHandshakeResponseReceived":
        log({ who: name, kind: "ws.open", url: shortWs(wsUrls.get(p.requestId)), status: p.response.status });
        break;
      case "Network.webSocketFrameReceived":
        wsFrames.set(p.requestId, (wsFrames.get(p.requestId) || 0) + 1);
        if (wsUrls.get(p.requestId)?.includes("/ws?")) {
          try { const m = JSON.parse(p.response.payloadData); if (m.type && m.type !== "pong") log({ who: name, kind: "room.msg", type: m.type, quiet: true }); } catch {}
        }
        break;
      case "Network.webSocketFrameError":
        log({ who: name, kind: "ws.error", url: shortWs(wsUrls.get(p.requestId)), text: p.errorMessage });
        break;
      case "Network.webSocketClosed":
        log({ who: name, kind: "ws.closed", url: shortWs(wsUrls.get(p.requestId)), frames: wsFrames.get(p.requestId) });
        wsUrls.delete(p.requestId);
        break;
      case "Inspector.targetCrashed":
        log({ who: name, kind: "CRASH", text: "renderer crashed" });
        break;
    }
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Log.enable");
  await send("Inspector.enable").catch(() => {});
  await send("Performance.enable", { timeDomain: "threadTicks" }).catch(() => {});
  await send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
  if (process.env.LKDEBUG) await send("Page.addScriptToEvaluateOnNewDocument", { source: LKDEBUG });
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const page = {
    name, sessionId, send, targetId,
    openWs: () => [...wsUrls.values()].map(shortWs),
    async metrics() { const r = await send("Performance.getMetrics", {}, 8000); return Object.fromEntries(r.metrics.map((m) => [m.name, m.value])); },
    async clearCache() { await send("Network.clearBrowserCache"); await send("Network.clearBrowserCookies"); },
    async eval(expression, timeoutMs = 20000) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async goto(url) { await send("Page.navigate", { url }); },
    async reload() { await send("Page.reload", { ignoreCache: false }); },
    /** Клик настоящими событиями мыши по центру элемента, найденного выражением. */
    async click(expr) {
      const pt = await page.eval(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({block:'center'}); const b = el.getBoundingClientRect(); if (!b.width) return null; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      if (!pt) return false;
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", { type, x: pt.x, y: pt.y, button: "left", clickCount: 1 });
      }
      return true;
    },
    async type(text) { await send("Input.insertText", { text }); },
    async key(key, code, vk) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    },
    async drag(x1, y1, x2, y2, steps = 8) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1, y: y1 });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x1, y: y1, button: "left", clickCount: 1 });
      for (let i = 1; i <= steps; i++) {
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps, button: "left", buttons: 1 });
      }
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x2, y: y2, button: "left", clickCount: 1 });
    },
    async shot(path) {
      const { data } = await send("Page.captureScreenshot", { format: "png" }, 30000);
      (await import("node:fs")).writeFileSync(path, Buffer.from(data, "base64"));
    },
    buttons: () => page.eval(`[...document.querySelectorAll('button,[role=button],[role=menuitem],[role=tab]')].filter(b=>b.getBoundingClientRect().width>0).map(b=>(b.getAttribute('aria-label')||'')+' | '+(b.textContent||'').trim().slice(0,40)+' | '+(b.getAttribute('aria-pressed')||b.getAttribute('data-state')||''))`),
  };
  return page;
}

function shortWs(url) {
  if (!url) return url;
  return url.replace(/token=[^&]+/g, "token=…").replace(/access_token=[^&]+/g, "access_token=…").slice(0, 160);
}

export const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.getBoundingClientRect().width > 0 && (e.textContent||'').trim().includes(${JSON.stringify(text)}))`;
export const byLabel = (label) => `[...document.querySelectorAll('[aria-label]')].find(e => e.getBoundingClientRect().width > 0 && e.getAttribute('aria-label') === ${JSON.stringify(label)})`;
