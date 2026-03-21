import { Pool } from "pg";
import { env } from "./env";

export const db = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,              
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
});

db.connect()
  .then(client => { client.release(); console.log("Postgres connected"); })
  .catch(err  => { console.error("Postgres connection failed", err); process.exit(1); });