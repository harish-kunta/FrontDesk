import "dotenv/config";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL must be set before running migrations.");

async function main() {
  const connection = postgres(databaseUrl, { max: 1, prepare: false });
  const db = drizzle(connection);

  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
  } finally {
    await connection.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
