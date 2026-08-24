import { describe, expect, it, vi } from "vitest";

const { hocuspocusMock } = vi.hoisted(() => ({
  hocuspocusMock: {
    hocuspocus: {
      closeConnections: vi.fn(),
    },
  },
}));

vi.mock("./hocuspocus.js", () => hocuspocusMock);

const { closeCanvasDocument } = await import("./service.js");

describe("closeCanvasDocument (Э3.2)", () => {
  it("закрывает все подключения Hocuspocus к документу этого урока по lessonId", () => {
    closeCanvasDocument("lesson-1");
    expect(hocuspocusMock.hocuspocus.closeConnections).toHaveBeenCalledWith("lesson-1");
  });
});
