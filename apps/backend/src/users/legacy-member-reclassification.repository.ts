import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { LegacyMemberReclassificationResult } from './legacy-member-reclassification.service';

const RECLASSIFICATION_SELECT = {
  id: true,
  role: true,
  selectedRole: true,
  selectedMemberKind: true,
  hasStaffAccess: true,
  hasAdminAccess: true,
  name: true,
  studentId: true,
  department: true,
  profile: {
    select: {
      name: true,
      studentId: true,
      department: true,
      memberKind: true,
      affiliationKind: true,
      affiliationName: true,
    },
  },
} as const satisfies Prisma.UserSelect;

export type LegacyMemberReclassificationRecord = Prisma.UserGetPayload<{
  select: typeof RECLASSIFICATION_SELECT;
}>;

export interface LegacyMemberReclassificationStore {
  findByGithubIdForUpdate(
    githubId: bigint,
  ): Promise<LegacyMemberReclassificationRecord | null>;
  save(
    userId: string,
    result: LegacyMemberReclassificationResult,
  ): Promise<void>;
}

export interface LegacyMemberReclassificationRepositoryPort {
  withTransaction<T>(
    operation: (store: LegacyMemberReclassificationStore) => Promise<T>,
  ): Promise<T>;
}

class PrismaLegacyMemberReclassificationStore implements LegacyMemberReclassificationStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  async findByGithubIdForUpdate(
    githubId: bigint,
  ): Promise<LegacyMemberReclassificationRecord | null> {
    const rows = await this.transaction.$queryRaw<readonly { id: string }[]>(
      Prisma.sql`SELECT "id" FROM "User" WHERE "githubId" = ${githubId} FOR UPDATE`,
    );
    const row = rows[0];
    if (row === undefined) return null;
    return this.transaction.user.findUnique({
      where: { id: row.id },
      select: RECLASSIFICATION_SELECT,
    });
  }

  async save(
    userId: string,
    result: LegacyMemberReclassificationResult,
  ): Promise<void> {
    const profile = {
      name: result.name,
      studentId: result.studentId,
      department: result.affiliationName,
      memberKind: result.memberKind,
      affiliationKind: result.affiliationKind,
      affiliationName: result.affiliationName,
    };
    await this.transaction.userProfile.upsert({
      where: { userId },
      create: { userId, ...profile },
      update: profile,
    });
    await this.transaction.user.update({
      where: { id: userId },
      data: {
        selectedMemberKind: result.memberKind,
        name: result.name,
        studentId: result.studentId,
        department: result.affiliationName,
        hasStaffAccess: result.hasStaffAccess,
      },
    });
  }
}

@Injectable()
export class LegacyMemberReclassificationRepository implements LegacyMemberReclassificationRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  withTransaction<T>(
    operation: (store: LegacyMemberReclassificationStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaLegacyMemberReclassificationStore(transaction)),
    );
  }
}
