// src/prismaClient.js
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;

// ✅ Build DB URL with optimized pool settings
const dbUrl = process.env.DATABASE_URL?.includes("?")
  ? `${process.env.DATABASE_URL}&connection_limit=10&pool_timeout=30&connect_timeout=10`
  : `${process.env.DATABASE_URL}?connection_limit=10&pool_timeout=30&connect_timeout=10`;

// ✅ Create SINGLE Prisma instance
const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ["error", "warn"],

    datasources: {
      db: {
        url: dbUrl,
      },
    },
  });

// ✅ Prevent multiple instances (important in dev)
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;