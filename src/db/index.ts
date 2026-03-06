import { drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL || "postgres://satvik:satvik123@localhost:5433/satvikscan";

export const db = drizzle({
  connection: databaseUrl,
  schema,
});
