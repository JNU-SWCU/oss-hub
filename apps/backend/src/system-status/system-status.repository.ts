import { Injectable } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import { CollectionCanonicalRepository } from '../collection/collection-canonical.repository';
import type { CanonicalStatusSnapshot } from '../collection/collection-canonical.types';
import { PrismaService } from '../prisma/prisma.service';

export interface SystemStatusSnapshot extends CanonicalStatusSnapshot {
  lastCompleteSuccessAt: Date | null;
  dataAsOf: Date | null;
}

export interface SystemStatusActor {
  role: Role | null;
  accountStatus: AccountStatus;
}

@Injectable()
export class SystemStatusRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly canonicalRepository: CollectionCanonicalRepository,
  ) {}

  findActor(githubId: bigint): Promise<SystemStatusActor | null> {
    return this.prisma.user.findUnique({
      where: { githubId },
      select: { role: true, accountStatus: true },
    });
  }

  async getStatusSnapshot(): Promise<SystemStatusSnapshot | null> {
    const keys = await this.prisma.$queryRawUnsafe<
      Array<{ appId: bigint; organizationLogin: string }>
    >(
      `SELECT "appId", "organizationLogin" FROM "CanonicalOrganizationState" ORDER BY "updatedAt" DESC LIMIT 1`,
    );
    const key = keys[0];
    if (!key) return null;

    const canonical = await this.canonicalRepository.getStatusSnapshot(key);
    if (!canonical) return null;

    const timestamps = await this.prisma.$queryRawUnsafe<
      Array<{
        lastCompleteSuccessAt: Date | null;
        dataAsOf: Date | null;
      }>
    >(
      `SELECT
         MAX(r."finishedAt") FILTER (WHERE r."status" = 'SUCCEEDED') AS "lastCompleteSuccessAt",
         active."finishedAt" AS "dataAsOf"
       FROM "CanonicalOrganizationState" s
       LEFT JOIN "CanonicalCollectionRun" r
         ON r."appId" = s."appId" AND r."organizationLogin" = s."organizationLogin"
       LEFT JOIN "CanonicalCollectionRun" active ON active."id" = s."activeGenerationId"
       WHERE s."appId" = $1 AND s."organizationLogin" = $2
       GROUP BY active."finishedAt"`,
      key.appId,
      key.organizationLogin,
    );

    return {
      ...canonical,
      lastCompleteSuccessAt: timestamps[0]?.lastCompleteSuccessAt ?? null,
      dataAsOf: timestamps[0]?.dataAsOf ?? null,
    };
  }
}
