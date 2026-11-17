import { TEST_READ_LIMIT } from '../../test/test-read-limit.config';
import type { GithubUserActivityObservation } from '@prisma/client';

import type { PrismaService } from '../platform/prisma.service';

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
): Promise<GithubUserActivityObservation[]> =>
  prisma.githubUserActivityObservation.findMany({
    take: TEST_READ_LIMIT,
    where: { githubId: { notIn: [...seededGithubIds] } },
  });

export const restoreForeignActivityRows = async (
  prisma: PrismaService,
  seededGithubIds: readonly bigint[],
  snapshot: readonly GithubUserActivityObservation[],
): Promise<void> => {
  await prisma.githubUserActivityObservation.deleteMany({
    where: { githubId: { notIn: [...seededGithubIds] } },
  });
  if (snapshot.length === 0) return;
  await prisma.githubUserActivityObservation.createMany({
    data: [...snapshot],
  });
};
