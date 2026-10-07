import { MilestoneDocumentKind, Prisma } from '@prisma/client';

export interface LockedMilestoneDocumentRow {
  readonly id: string;
}

export interface LockedMilestoneRow {
  readonly id: string;
}

export async function lockMilestone(
  client: Prisma.TransactionClient,
  milestoneId: string,
): Promise<LockedMilestoneRow | null> {
  const rows = await client.$queryRaw<readonly LockedMilestoneRow[]>(
    Prisma.sql`SELECT "id" FROM "Milestone" WHERE "id" = ${milestoneId} FOR UPDATE`,
  );
  return rows[0] ?? null;
}

export function lockMilestoneDocumentsOfMilestone(
  client: Prisma.TransactionClient,
  milestoneId: string,
  kind?: MilestoneDocumentKind,
): Promise<readonly LockedMilestoneDocumentRow[]> {
  if (kind === undefined) {
    return client.$queryRaw<readonly LockedMilestoneDocumentRow[]>(Prisma.sql`
      SELECT "id"
      FROM "MilestoneDocument"
      WHERE "milestoneId" = ${milestoneId}
      ORDER BY "id"
      FOR UPDATE
    `);
  }
  return client.$queryRaw<readonly LockedMilestoneDocumentRow[]>(Prisma.sql`
    SELECT "id"
    FROM "MilestoneDocument"
    WHERE "milestoneId" = ${milestoneId}
      AND "kind" = ${kind}::"MilestoneDocumentKind"
    ORDER BY "id"
    FOR UPDATE
  `);
}
