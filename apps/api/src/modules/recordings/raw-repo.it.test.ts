import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { Pool } from "pg";

/**
 * Интеграционный тест SQL экспериментальной записи на настоящем Postgres:
 * лизы рекордера и рендера, `SKIP LOCKED`, сверка пропавших воркеров.
 * Запускается только с RAW_REPO_IT_DATABASE_URL (пустая одноразовая БД —
 * тест накатывает миграции и чистит таблицы). Без переменной — пропуск.
 *
 *   docker run -d --rm --name raw-it -e POSTGRES_PASSWORD=t -p 127.0.0.1:55432:5432 postgres:17
 *   RAW_REPO_IT_DATABASE_URL=postgres://postgres:t@127.0.0.1:55432/postgres vitest run raw-repo.it
 */

const url = process.env.RAW_REPO_IT_DATABASE_URL;
const here = path.dirname(fileURLToPath(import.meta.url));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../../db/client.js", () => ({
  get db() {
    return holder.db;
  },
}));

const pool = url ? new Pool({ connectionString: url, max: 10 }) : null;
const schema = await import("../../db/schema.js");
const repo = await import("./raw-repo.js");

const SCHOOL = randomUUID();
const USER = randomUUID();
const LESSON = randomUUID();
const LESSON2 = randomUUID();

describe.skipIf(!url)("raw-repo на Postgres", () => {
  beforeAll(async () => {
    const db = drizzle(pool!, { schema });
    holder.db = db;
    await migrate(drizzle(pool!), { migrationsFolder: path.resolve(here, "../../../drizzle") });
    await db.execute(sql`INSERT INTO schools (id, name, slug) VALUES (${SCHOOL}, 'IT', ${"it-" + SCHOOL.slice(0, 8)})`);
    await db.execute(
      sql`INSERT INTO users (id, school_id, email, password_hash, full_name, role) VALUES (${USER}, ${SCHOOL}, ${USER + "@it"}, 'x', 'IT', 'teacher')`,
    );
    for (const id of [LESSON, LESSON2]) {
      await db.execute(sql`INSERT INTO lessons (id, school_id, teacher_id, title) VALUES (${id}, ${SCHOOL}, ${USER}, 'IT')`);
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    const db = holder.db as ReturnType<typeof drizzle>;
    await db.execute(sql`DELETE FROM raw_recordings`);
  });

  async function insert(lessonId = LESSON) {
    const id = randomUUID();
    const row = await repo.insertRawRecording({
      id,
      schoolId: SCHOOL,
      lessonId,
      startedBy: USER,
      livekitRoom: `lesson-${lessonId}`,
      recordingDir: `raw-recordings/${SCHOOL}/${lessonId}/${id}`,
      outputKey: `recordings/${SCHOOL}/${lessonId}/${id}.mp4`,
      compareRecordingId: null,
    });
    return row!;
  }

  async function backdate(id: string, column: "recorder_heartbeat_at" | "render_heartbeat_at", secondsAgo: number) {
    const db = holder.db as ReturnType<typeof drizzle>;
    await db.execute(sql`UPDATE raw_recordings SET ${sql.raw(column)} = now() - ${secondsAgo} * interval '1 second' WHERE id = ${id}`);
  }

  it("одна идущая запись на урок: вторая вставка не создаёт строку", async () => {
    await insert();
    const dup = await repo.insertRawRecording({
      id: randomUUID(),
      schoolId: SCHOOL,
      lessonId: LESSON,
      startedBy: USER,
      livekitRoom: "x",
      recordingDir: "x",
      outputKey: "x",
      compareRecordingId: null,
    });
    expect(dup).toBeNull();
  });

  it("параллельные рекордеры не берут одно задание (SKIP LOCKED)", async () => {
    await insert(LESSON);
    await insert(LESSON2);
    const claims = await Promise.all(
      Array.from({ length: 6 }, (_, i) => repo.claimRecordJob(`w${i}`, randomUUID())),
    );
    const got = claims.filter((c) => c !== null).map((c) => c!.id);
    expect(got).toHaveLength(2);
    expect(new Set(got).size).toBe(2);
    expect(claims.filter((c) => c !== null).every((c) => c!.attempt === 1 && c!.status === "recording")).toBe(true);
  });

  it("пропавший рекордер без стопа → снова requested, следующий берёт попыткой 2", async () => {
    const row = await insert();
    const lease1 = randomUUID();
    await repo.claimRecordJob("w1", lease1);
    await backdate(row.id, "recorder_heartbeat_at", 60);
    const expired = await repo.expireRecorderLeases(new Date(Date.now() - 30_000));
    expect(expired.map((r) => r.status)).toEqual(["requested"]);
    // Старый рекордер ожил — его лиза больше не действует.
    expect(await repo.touchRecorderLease(row.id, lease1, {})).toBeNull();
    const second = await repo.claimRecordJob("w2", randomUUID());
    expect(second).toMatchObject({ id: row.id, attempt: 2 });
  });

  it("пропавший рекордер после стопа → данные на рендер", async () => {
    const row = await insert();
    await repo.claimRecordJob("w1", randomUUID());
    await repo.updateRawRecordingIf(row.id, ["recording"], { status: "finalizing", stopRequestedAt: new Date() });
    await backdate(row.id, "recorder_heartbeat_at", 60);
    const expired = await repo.expireRecorderLeases(new Date(Date.now() - 30_000));
    expect(expired.map((r) => r.status)).toEqual(["queued_for_render"]);
  });

  it("стоп до того, как рекордер взял задание: без попыток → aborted", async () => {
    const row = await insert();
    await repo.updateRawRecordingIf(row.id, ["requested"], { stopRequestedAt: new Date() });
    const settled = await repo.settleStoppedUnclaimed();
    expect(settled.map((r) => r.status)).toEqual(["aborted"]);
    // стоп-запрошенную рекордер не берёт
    expect(await repo.claimRecordJob("w", randomUUID())).toBeNull();
  });

  it("финиш рекордера идемпотентен: повтор по той же лизе ничего не меняет", async () => {
    const row = await insert();
    const lease = randomUUID();
    await repo.claimRecordJob("w1", lease);
    const first = await repo.finishRecorderLease(row.id, lease, { stats: { tracks: 2 }, lastError: null });
    expect(first?.status).toBe("queued_for_render");
    expect(await repo.finishRecorderLease(row.id, lease, { stats: {}, lastError: null })).toBeNull();
  });

  it("рендер: пропал → в очередь; исчерпал попытки → failed", async () => {
    const row = await insert();
    const lease = randomUUID();
    await repo.claimRecordJob("w1", lease);
    await repo.finishRecorderLease(row.id, lease, { stats: {}, lastError: null });

    for (let attempt = 1; attempt <= 3; attempt++) {
      const renderLease = randomUUID();
      const claimed = await repo.claimRenderJob("r1", renderLease, 3);
      expect(claimed).toMatchObject({ id: row.id, renderAttempts: attempt, status: "rendering" });
      await backdate(row.id, "render_heartbeat_at", 600);
      const expired = await repo.expireRenderLeases(new Date(Date.now() - 180_000), 3);
      expect(expired[0]!.status).toBe(attempt < 3 ? "queued_for_render" : "failed");
      // Опоздавший отчёт пропавшего рендера не публикует результат.
      expect(await repo.completeRenderLease(row.id, renderLease, { status: "ready" })).toBeNull();
    }
    expect(await repo.claimRenderJob("r1", randomUUID(), 3)).toBeNull();
  });

  it("журнал: повтор (recording, seq) пропускается, страницы по порядку", async () => {
    const row = await insert();
    const ev = (seq: number) => ({ recordingId: row.id, seq, tsMs: 1000 + seq, kind: "yjs_update", payload: null, data: Buffer.from([seq]) });
    await repo.insertJournalEvents([ev(1), ev(2), ev(3)]);
    await repo.insertJournalEvents([ev(2), ev(3), ev(4)]);
    expect(await repo.countJournalEvents(row.id)).toBe(4);
    expect(await repo.maxJournalSeq(row.id)).toBe(4);
    const page = await repo.listJournalPage(row.id, 1, 2);
    expect(page.map((r) => r.seq)).toEqual([2, 3]);
    expect(page[0]!.data).toEqual(Buffer.from([2]));
  });
});
