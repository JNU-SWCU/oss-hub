import { MemberKind, AccountStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import {
  STUDENT_MEMBER_WHERE,
  USER_PROFILE_NAME_SELECT,
  userProfileNameWhere,
  resolveUserProfileName,
} from '../profiles/user-profile-read';

/** 초대 검색 결과 후보 — 공개 가능한 필드만 담는다. */
export interface InvitationCandidateRecord {
  readonly id: string;
  readonly nickname: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
}

export type InviteeEligibility = 'eligible' | 'not-found' | 'not-eligible';

export async function getInviteeEligibility(
  prisma: Pick<PrismaService, 'user'>,
  userId: string,
): Promise<InviteeEligibility> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      accountStatus: true,
      profile: { select: { memberKind: true } },
    },
  });
  if (!user) return 'not-found';
  return user.profile?.memberKind === MemberKind.STUDENT &&
    user.accountStatus === AccountStatus.ACTIVE
    ? 'eligible'
    : 'not-eligible';
}

/**
 * 이름 또는 GitHub handle 부분 일치 검색. 본인과 같은 프로그램 팀 소속 사용자는
 * 제외하고, 학번·이메일·연락처는 조회하지 않는다.
 */
export async function searchInvitationCandidates(
  prisma: Pick<PrismaService, 'user'>,
  programId: string,
  query: string,
  excludeUserId: string,
): Promise<InvitationCandidateRecord[]> {
  const users = await prisma.user.findMany({
    where: {
      id: { not: excludeUserId },
      ...STUDENT_MEMBER_WHERE,
      accountStatus: AccountStatus.ACTIVE,
      OR: [
        { nickname: { contains: query, mode: 'insensitive' } },
        userProfileNameWhere(query),
      ],
      teamMemberships: { none: { programId } },
    },
    select: {
      id: true,
      nickname: true,
      ...USER_PROFILE_NAME_SELECT,
      avatarUrl: true,
    },
    orderBy: { nickname: 'asc' },
    take: 20,
  });
  return users.map((user) => ({
    id: user.id,
    nickname: user.nickname,
    name: resolveUserProfileName(user),
    avatarUrl: user.avatarUrl,
  }));
}
