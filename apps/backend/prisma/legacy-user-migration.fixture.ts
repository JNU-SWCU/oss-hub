import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

export async function inLegacyUserSchema<T>(
  prisma: Pick<PrismaClient, '$transaction' | '$executeRawUnsafe'>,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const schema = `legacy_user_${randomUUID().replaceAll('-', '')}`;
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  try {
    return await prisma.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(
        `SET LOCAL search_path TO "${schema}"`,
      );
      for (const statement of [
        `CREATE TYPE "Role" AS ENUM ('STUDENT', 'STAFF', 'ADMIN')`,
        `CREATE TYPE "RoleRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED')`,
        `CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "role" "Role")`,
        `CREATE TABLE "RoleRequest" (
          "id" TEXT PRIMARY KEY,
          "userId" TEXT NOT NULL REFERENCES "User" ("id"),
          "status" "RoleRequestStatus" NOT NULL DEFAULT 'PENDING',
          "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
      ]) {
        await transaction.$executeRawUnsafe(statement);
      }
      return operation(transaction);
    });
  } finally {
    await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  }
}
