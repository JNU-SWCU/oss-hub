import type { GithubUserActivityHistory } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';

export const countForeignActiveUsers = async (
  prisma: PrismaService,
  seededGithubIds: readonly bigint[],
): Promise<number> =>
  prisma.user.count({
    where: {
      accountStatus: 'ACTIVE',
      githubId: { notIn: [...seededGithubIds] },
    },
  });

export const snapshotForeignActivityRows = (
  prisma: PrismaService,
  seededGithubIds: readonly bigint[],
): Promise<GithubUserActivityHistory[]> =>
  prisma.githubUserActivityHistory.findMany({
    where: { githubId: { notIn: [...seededGithubIds] } },
  });

export const restoreForeignActivityRows = async (
  prisma: PrismaService,
  seededGithubIds: readonly bigint[],
  snapshot: readonly GithubUserActivityHistory[],
): Promise<void> => {
  await prisma.githubUserActivityHistory.deleteMany({
    where: { githubId: { notIn: [...seededGithubIds] } },
  });
  if (snapshot.length === 0) return;
  await prisma.githubUserActivityHistory.createMany({ data: [...snapshot] });
};
