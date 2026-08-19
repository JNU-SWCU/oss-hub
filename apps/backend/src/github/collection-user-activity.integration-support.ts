import type { GithubUserActivityHistory } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';

/**
 * 사람 축 sweep 통합 스펙 전용 격리 도구.
 *
 * `CollectionUserActivityService`는 `accountStatus: ACTIVE`인 `User` **전원**을 도는 게
 * 제품 동작이다(`service/collection-user-activity.service.ts`). CI는 79개 통합 스펙이
 * Postgres 하나를 공유하므로, sweep 스펙이 돌 때 형제 스펙이 심어 둔 ACTIVE 유저도
 * 정당하게 함께 관측된다. 그래서 sweep 스펙은 두 가지를 스스로 처리해야 한다.
 *
 * 1. **읽기 격리** — 전역 수치를 직접 못 박는 대신, 스펙이 통제하지 못하는 몫을
 *    기준선으로 세고 `기준선 + 시드 수`로 고정한다(`countForeignActiveUsers`).
 * 2. **쓰기 격리** — sweep이 형제 유저에게 남긴 관측 행을 원상복구한다. 복구하지
 *    않으면 랭킹을 읽는 스펙(`public-exposure-*`)이 실행 순서에 따라 깨진다.
 *    형제 데이터를 지우는 게 아니라 **sweep 이전 상태로 되돌리는** 것이다.
 */
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

/**
 * 시드 코호트 **밖** 관측 행 전량을 스냅샷한다. sweep 직전에 부른다.
 */
export const snapshotForeignActivityRows = (
  prisma: PrismaService,
  seededGithubIds: readonly bigint[],
): Promise<GithubUserActivityHistory[]> =>
  prisma.githubUserActivityHistory.findMany({
    where: { githubId: { notIn: [...seededGithubIds] } },
  });

/**
 * 스냅샷 시점 상태로 되돌린다 — sweep이 새로 만든 형제 행은 지우고, sweep이 덮어쓴
 * 형제 행은 원래 값으로 되돌린다. 시드 코호트 행은 건드리지 않는다.
 */
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
