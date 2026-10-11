import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl && process.env.NODE_ENV === "production") {
  throw new Error("DATABASE_URL must be set in production.");
}

const globalForDatabase = globalThis as unknown as {
  postgresClient?: ReturnType<typeof postgres>;
};

const client =
  globalForDatabase.postgresClient ??
  postgres(databaseUrl ?? "postgres://frontdesk:frontdesk@localhost:5432/frontdesk", {
    max: 5,
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") globalForDatabase.postgresClient = client;

export const db = drizzle(client, { schema });
