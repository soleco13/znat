// Сводка медиа одного браузера (вызывается раз в 2 с). Работает и для Матиса, и для Контура:
// берёт все живые RTCPeerConnection из __pcs (обёртка cdp.mjs INSTRUMENT).
(async () => {
  const out = { t: Date.now(), inA: [], inV: [], outV: [], outA: [], srcA: [], pair: null, vis: document.visibilityState };
  for (const pc of window.__pcs || []) {
    if (pc.connectionState === "closed") continue;
    const st = await pc.getStats(); const rep = {}; st.forEach((r) => (rep[r.id] = r));
    for (const r of Object.values(rep)) {
      if (r.type === "inbound-rtp" && r.kind === "audio" && r.packetsReceived > 0)
        out.inA.push({ id: r.ssrc, conc: r.concealedSamples, silConc: r.silentConcealedSamples, tot: r.totalSamplesReceived, jbd: r.jitterBufferDelay, jbe: r.jitterBufferEmittedCount, lost: r.packetsLost, rcv: r.packetsReceived, ce: r.concealmentEvents, bytes: r.bytesReceived, energy: r.totalAudioEnergy });
      if (r.type === "inbound-rtp" && r.kind === "video" && r.bytesReceived > 0)
        out.inV.push({ id: r.ssrc, fd: r.framesDecoded, h: r.frameHeight, w: r.frameWidth, fz: r.freezeCount, fzd: r.totalFreezesDuration, bytes: r.bytesReceived, codec: rep[r.codecId]?.mimeType, dec: r.totalDecodeTime, lost: r.packetsLost, rcv: r.packetsReceived });
      if (r.type === "outbound-rtp" && r.kind === "video" && r.bytesSent > 0)
        out.outV.push({ id: r.ssrc, rid: r.rid, fe: r.framesEncoded, h: r.frameHeight, w: r.frameWidth, ql: r.qualityLimitationReason, bytes: r.bytesSent, enc: r.totalEncodeTime, codec: rep[r.codecId]?.mimeType, sm: r.scalabilityMode });
      if (r.type === "outbound-rtp" && r.kind === "audio" && r.bytesSent > 0)
        out.outA.push({ id: r.ssrc, bytes: r.bytesSent, codec: rep[r.codecId]?.mimeType });
      if (r.type === "media-source" && r.kind === "audio" && typeof r.totalSamplesDuration === "number")
        out.srcA.push({ id: r.id, dur: r.totalSamplesDuration, ts: r.timestamp });
      if (r.type === "candidate-pair" && r.nominated && r.state === "succeeded" && r.bytesReceived > 1000)
        out.pair = { rtt: r.currentRoundTripTime, outBw: r.availableOutgoingBitrate, rx: r.bytesReceived, tx: r.bytesSent };
    }
  }
  return JSON.stringify(out);
})()
