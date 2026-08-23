import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  COOKIE_SECRET: z.string().min(32),
  STORAGE_ROOT: z.string().min(1).default("/data/assets"),
  STORAGE_HMAC_SECRET: z.string().min(32),
  PUBLIC_ORIGIN: z.string().url().default("http://localhost:3000"),
  WEB_DIST_DIR: z.string().min(1).default("apps/web/dist"),
});

export const env = envSchema.parse(process.env);
export type Env = typeof env;
