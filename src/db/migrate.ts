import fs from "fs";
import path from "path";
import { db } from "../config/db";

async function migrate() {
  // Create a tracking table if it doesn't exist yet.
  // This records which migrations have already run so they never run twice.
  await db.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id         SERIAL PRIMARY KEY,
      filename   TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Find all .sql files in the migrations folder, sorted by filename.
  // The numeric prefix (001_, 002_) is what controls the order.
  const migrationsDir = path.join(__dirname, "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    // Skip if this migration was already applied
    const { rows } = await db.query(
      "SELECT id FROM migrations WHERE filename = $1",
      [file]
    );
    if (rows.length > 0) {
      console.log(`  skip  ${file}`);
      continue;
    }

    // Read and execute the SQL file
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    await db.query(sql);

    // Record that it ran
    await db.query(
      "INSERT INTO migrations (filename) VALUES ($1)",
      [file]
    );

    console.log(`  ran   ${file}`);
  }

  console.log("Migrations done.");
  await db.end();
}

migrate().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
        