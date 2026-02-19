import { PrismaClient } from "@prisma/client";

declare global {
  var __hookforgePrisma: PrismaClient | undefined;
}

export const prisma =
  global.__hookforgePrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  global.__hookforgePrisma = prisma;
}
