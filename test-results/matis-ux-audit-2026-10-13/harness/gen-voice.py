#!/usr/bin/env python3
"""Синтетическая «речь» для фейковых микрофонов Chrome. Голоса у участников
РАЗНЫЕ: с одинаковым сигналом эхоподавление ученика вычищает его голос."""
import wave, struct, math, random
def gen(fn, base, syl_rate, period, pause, seed):
    sr = 48000; dur = 9.0; random.seed(seed); fr = bytearray()
    for n in range(int(sr * dur)):
        t = n / sr
        f0 = base + 50 * math.sin(2 * math.pi * 0.43 * t) + 12 * math.sin(2 * math.pi * 6 * t)
        ph = 2 * math.pi * f0 * t
        s = sum((0.6 / k) * math.sin(k * ph + k) for k in range(1, 9))
        syl = max(0.0, math.sin(2 * math.pi * syl_rate * t + 1.3)) ** 0.6
        gate = 0.0 if (t % period) > period - pause else 1.0
        v = s * syl * gate * 0.45 + random.uniform(-0.01, 0.01)
        fr += struct.pack('<h', int(max(-1, min(1, v)) * 32767))
    w = wave.open(fn, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(bytes(fr)); w.close()
gen('voice-teacher.wav', 150, 3.3, 4.5, 0.9, 1)
gen('voice-student.wav', 260, 4.4, 3.0, 0.6, 2)
