import { PrismaClient } from "@prisma/client";
import { env } from "./env";

// Standard singleton pattern so ts-node-dev restarts / hot reloads don't
// exhaust the Postgres connection pool with duplicate clients.
declare global {
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClient | undefined;
}

export const prisma =
  global.__prisma__ ??
  new PrismaClient({
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (env.NODE_ENV !== "production") {
  global.__prisma__ = prisma;
}
