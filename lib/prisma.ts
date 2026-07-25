import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

declare global {
  var __aimautaPrisma: PrismaClient | undefined;
}

export class DatabaseUnavailableError extends Error {
  constructor() {
    super("El directorio escolar todavía no está configurado.");
    this.name = "DatabaseUnavailableError";
  }
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new DatabaseUnavailableError();
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

function getPrismaClient(): PrismaClient {
  const cached = globalThis.__aimautaPrisma;
  if (cached) {
    return cached;
  }

  const client = createPrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalThis.__aimautaPrisma = client;
  }
  return client;
}

/**
 * Route modules are imported during `next build`. The proxy keeps database
 * access request-scoped so an optional, unconfigured directory cannot prevent
 * the PDF/RAG application from building or starting.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, client) as unknown;
    return typeof value === "function" ? value.bind(client) : value;
  }
});
