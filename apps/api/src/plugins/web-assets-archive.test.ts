import { mkdirSync, mkdtempSync, readdirSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { syncAssetsArchive } from "./web-assets-archive.js";

function dirs() {
  const root = mkdtempSync(path.join(tmpdir(), "assets-archive-"));
  const dist = path.join(root, "dist");
  const archive = path.join(root, "archive");
  mkdirSync(dist);
  return { dist, archive };
}

describe("архив файлов сборки фронта", () => {
  it("копирует текущую сборку и сохраняет файлы прошлой", () => {
    const { dist, archive } = dirs();
    writeFileSync(path.join(dist, "Board-old.js"), "old");
    syncAssetsArchive(dist, archive);
    // Новая выкладка: в образе только новые файлы.
    writeFileSync(path.join(dist, "Board-new.js"), "new");
    unlinkSync(path.join(dist, "Board-old.js"));
    const result = syncAssetsArchive(dist, archive);
    expect(result.copied).toBe(1);
    expect(readdirSync(archive).sort()).toEqual(["Board-new.js", "Board-old.js"]);
  });

  it("удаляет файлы старых сборок через 30 дней, текущие не трогает", () => {
    const { dist, archive } = dirs();
    writeFileSync(path.join(dist, "current.js"), "c");
    syncAssetsArchive(dist, archive);
    writeFileSync(path.join(archive, "ancient.js"), "a");
    writeFileSync(path.join(archive, "recent.js"), "r");
    const now = Date.now();
    const old = (now - 31 * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(path.join(archive, "ancient.js"), old, old);
    utimesSync(path.join(archive, "current.js"), old, old);
    const result = syncAssetsArchive(dist, archive, now);
    expect(result.removed).toBe(1);
    expect(readdirSync(archive).sort()).toEqual(["current.js", "recent.js"]);
  });
});
