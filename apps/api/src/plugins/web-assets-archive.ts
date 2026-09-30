import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

/**
 * Архив файлов сборки фронта между выкладками.
 *
 * Фронт разбит на куски (React.lazy): страница, открытая ДО выкладки,
 * подгружает доску, задания и т.п. по именам своей сборки. После выкладки в
 * образе остаются только новые файлы — старые куски пропадали, загрузка доски
 * падала, и урок у ученика уходил в экран ошибки (2026-09-26). Поэтому при
 * старте копируем текущие `assets/` в постоянный том и отдаём оттуда то, чего
 * нет в текущей сборке. Файлы старых сборок живут `MAX_AGE_MS` — дольше
 * вкладку урока не держат.
 */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function syncAssetsArchive(
  distAssetsDir: string,
  archiveDir: string,
  now = Date.now(),
): { copied: number; removed: number } {
  mkdirSync(archiveDir, { recursive: true });
  const current = new Set(existsSync(distAssetsDir) ? readdirSync(distAssetsDir) : []);
  let copied = 0;
  let removed = 0;
  for (const name of current) {
    const target = path.join(archiveDir, name);
    if (existsSync(target)) continue;
    const source = path.join(distAssetsDir, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, target);
    copied += 1;
  }
  for (const name of readdirSync(archiveDir)) {
    if (current.has(name)) continue;
    const file = path.join(archiveDir, name);
    const stat = statSync(file);
    if (stat.isFile() && now - stat.mtimeMs > MAX_AGE_MS) {
      unlinkSync(file);
      removed += 1;
    }
  }
  return { copied, removed };
}
