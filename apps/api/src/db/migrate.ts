import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { env } from "../plugins/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// src/db/migrate.ts -> ../../drizzle ; dist/db/migrate.js -> ../../drizzle
const migrationsFolder = path.resolve(here, "../../drizzle");

// Свой пул без statement_timeout рабочего: CREATE INDEX на большой таблице дольше 15 с.
const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
await migrate(drizzle(pool), { migrationsFolder });
await pool.end();
console.log("Migrations applied.");
