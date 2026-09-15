// src/prisma.js
//
// Kept only for backward compatibility with any import of "../prisma.js".
// It re-exports the single shared client — it must NOT create its own
// PrismaClient, because every extra client opens another connection pool.
export { default, isDbUnavailableError } from "./prismaClient.js";
