import { Redis } from "ioredis";
import { env } from "../plugins/env.js";

export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
