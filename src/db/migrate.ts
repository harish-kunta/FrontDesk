import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

async function main() {
  if (!databaseUrl) throw new Error("DATABASE_URL must be set before running migrations.");
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
