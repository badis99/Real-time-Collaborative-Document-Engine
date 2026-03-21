import { z } from "zod";
import dotenv from "dotenv";
dotenv.config();

const schema = z.object({
  PORT:                  z.string().default("4000"),
  NODE_ENV:              z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL:          z.string().url(),
  REDIS_URL:             z.string().url(),
  JWT_SECRET:            z.string().min(32),
  JWT_EXPIRES_IN:        z.string().default("7d"),
  REFRESH_TOKEN_SECRET:  z.string().min(32),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;