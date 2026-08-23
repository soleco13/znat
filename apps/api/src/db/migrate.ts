import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// src/db/migrate.ts -> ../../drizzle ; dist/db/migrate.js -> ../../drizzle
const migrationsFolder = path.resolve(here, "../../drizzle");

await migrate(db, { migrationsFolder });
await pool.end();
console.log("Migrations applied.");
