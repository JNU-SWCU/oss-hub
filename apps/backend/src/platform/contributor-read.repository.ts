import { READ_CAP } from './bounded-read.config';
import { BoundedReadRepository } from './bounded-read.repository';
import { Injectable } from '@nestjs/common';
import { ActivityVisibility, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { STANDING_SQL } from './contributor-read.config';

const boundedReads = new BoundedReadRepository();

export interface StandingFilter {
  readonly year: number | null;
  readonly visibility: ActivityVisibility | null;
}

const STANDING = Prisma.raw(STANDING_SQL);

function standingWhere(filter: StandingFilter): Prisma.Sql {
  const predicates: Prisma.Sql[] = [];
  if (filter.year !== null) predicates.push(Prisma.sql`year = ${filter.year}`);
  if (filter.visibility !== null)
    predicates.push(
      Prisma.sql`visibility = ${filter.visibility}::"ActivityVisibility"`,
    );
  return predicates.length
    ? Prisma.sql`WHERE ${Prisma.join(predicates, ' AND ')}`
    : Prisma.empty;
}

@Injectable()
export class ContributorReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async readStandingYears(filter: StandingFilter): Promise<readonly number[]> {
    const rows = await boundedReads.readCapped(
      READ_CAP.activityYears,
      'Standing years',
      (take) =>
        this.prisma.$queryRaw<{ year: number }[]>`
      SELECT DISTINCT year
      FROM ${STANDING}
      ${standingWhere(filter)}
      LIMIT ${take}
    `,
    );
    return rows.map((row) => row.year).sort((left, right) => right - left);
  }

  async readStandingObservedAt(filter: StandingFilter): Promise<Date | null> {
    const [row] = await this.prisma.$queryRaw<{ observedAt: Date | null }[]>`
      SELECT MAX(observed_at) AS "observedAt"
      FROM ${STANDING}
      ${standingWhere(filter)}
      LIMIT 1
    `;
    if (row === undefined) {
      throw new Error('Standing freshness query did not return a row');
    }
    return row.observedAt;
  }
}
