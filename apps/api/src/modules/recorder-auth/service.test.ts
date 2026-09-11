import { describe, expect, it, vi } from "vitest";

vi.mock("../../plugins/env.js", () => ({
  env: { JWT_RECORDER_SECRET: "test-recorder-secret-at-least-32-characters" },
}));

const service = await import("./service.js");

const LESSON = "22222222-2222-2222-2222-222222222222";
const RECORDING = "33333333-3333-3333-3333-333333333333";

describe("recorder-auth/service (Э10.6)", () => {
  it("подписывает и проверяет recorder-токен — payload совпадает", async () => {
    const token = await service.signRecorderToken(LESSON, RECORDING);
    const payload = await service.verifyRecorderToken(token);
    expect(payload).toEqual({ typ: "recorder", lessonId: LESSON, recordingId: RECORDING });
  });

  it("мусорный токен — null, не throw", async () => {
    await expect(service.verifyRecorderToken("not-a-jwt")).resolves.toBeNull();
  });

  it("токен, подписанный другим секретом — null (не даёт себя пройти по форме payload)", async () => {
    vi.resetModules();
    vi.doMock("../../plugins/env.js", () => ({
      env: { JWT_RECORDER_SECRET: "a-completely-different-secret-32-plus-chars" },
    }));
    const otherService = await import("./service.js");
    const foreignToken = await otherService.signRecorderToken(LESSON, RECORDING);
    vi.doUnmock("../../plugins/env.js");
    vi.resetModules();

    const freshService = await import("./service.js");
    await expect(freshService.verifyRecorderToken(foreignToken)).resolves.toBeNull();
  });
});
