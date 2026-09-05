import { describe, expect, it } from "vitest";
import { EgressStatus } from "livekit-server-sdk";
import { mapEgressStatus } from "./egress-client.js";

describe("mapEgressStatus (Э10 — проекция livekit.EgressStatus на RecordingStatus)", () => {
  it.each([
    [EgressStatus.EGRESS_STARTING, "starting"],
    [EgressStatus.EGRESS_ACTIVE, "recording"],
    [EgressStatus.EGRESS_ENDING, "processing"],
    [EgressStatus.EGRESS_COMPLETE, "ready"],
    [EgressStatus.EGRESS_FAILED, "failed"],
    [EgressStatus.EGRESS_LIMIT_REACHED, "failed"],
    [EgressStatus.EGRESS_ABORTED, "aborted"],
  ] as const)("%s → %s", (input, expected) => {
    expect(mapEgressStatus(input)).toBe(expected);
  });

  it("неизвестный статус → processing (не отдаём ложное «готово»)", () => {
    expect(mapEgressStatus(undefined)).toBe("processing");
    expect(mapEgressStatus(999 as unknown as EgressStatus)).toBe("processing");
  });
});
