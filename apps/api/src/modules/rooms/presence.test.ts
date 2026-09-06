import { describe, expect, it } from "vitest";
import { defaultPermissions, isStaleEntry, type PresenceEntry } from "./presence.js";

const GRACE_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;

function entry(overrides: Partial<PresenceEntry> = {}): PresenceEntry {
  return {
    fullName: "Тест",
    kind: "guest",
    role: null,
    connected: true,
    handRaised: false,
    pinned: false,
    permissions: defaultPermissions("guest"),
    joinedAt: new Date().toISOString(),
    lastSeenAt: Date.now(),
    ...overrides,
  };
}

describe("defaultPermissions", () => {
  it("персонал получает все права по умолчанию", () => {
    expect(defaultPermissions("staff")).toEqual({
      canDraw: true,
      canSpeak: true,
      canShareScreen: true,
      canPublishVideo: true,
    });
  });

  it("гость-ученик без прав по умолчанию", () => {
    expect(defaultPermissions("guest")).toEqual({
      canDraw: false,
      canSpeak: false,
      canShareScreen: false,
      canPublishVideo: false,
    });
  });
});

describe("isStaleEntry", () => {
  it("подключённый участник не считается зависшим, пока heartbeat идёт вовремя", () => {
    const e = entry({ connected: true, lastSeenAt: Date.now() - 10_000 });
    expect(isStaleEntry(e, Date.now(), GRACE_MS, HEARTBEAT_TIMEOUT_MS)).toBe(false);
  });

  it("подключённый участник считается зависшим после пропуска heartbeat", () => {
    const e = entry({ connected: true, lastSeenAt: Date.now() - HEARTBEAT_TIMEOUT_MS - 1 });
    expect(isStaleEntry(e, Date.now(), GRACE_MS, HEARTBEAT_TIMEOUT_MS)).toBe(true);
  });

  it("отключённый участник переживает разрыв в пределах grace-периода", () => {
    const e = entry({ connected: false, lastSeenAt: Date.now() - (GRACE_MS - 1000) });
    expect(isStaleEntry(e, Date.now(), GRACE_MS, HEARTBEAT_TIMEOUT_MS)).toBe(false);
  });

  it("отключённый участник зачищается после истечения grace-периода", () => {
    const e = entry({ connected: false, lastSeenAt: Date.now() - GRACE_MS - 1000 });
    expect(isStaleEntry(e, Date.now(), GRACE_MS, HEARTBEAT_TIMEOUT_MS)).toBe(true);
  });
});
