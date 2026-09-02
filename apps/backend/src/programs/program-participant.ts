import type { Prisma } from '@prisma/client';

export function programApplicationParticipantWhere(
  userId: string,
): Prisma.ApplicationWhereInput {
  return {
    OR: [
      { applicantId: userId },
      { team: { leaderId: userId } },
      { team: { members: { some: { userId } } } },
    ],
  };
}

/**
 * 신청서를 **바꿀 수 있는** 사람 — 신청자 본인과, 팀 신청이면 팀장.
 *
 * ⚠ 읽기(`programApplicationParticipantWhere`)보다 좁다. 읽기가 팀원 전원을 담는 것은
 * 의도된 범위지만(#570 판정 알림 수신자와 같은 집합) 쓰기까지 정당화하지 않는다.
 * 같은 조건을 재사용하면 팀원 아무나 팀 전체의 신청을 고치거나 하드 삭제할 수 있다(#1083).
 * 개인 신청도 신청자가 곧 1인 팀의 팀장이라(D5) 두 갈래가 같은 사람을 가리킨다.
 */
export function programApplicationManagerWhere(
  userId: string,
): Prisma.ApplicationWhereInput {
  return {
    OR: [{ applicantId: userId }, { team: { leaderId: userId } }],
  };
}

/**
 * 이미 읽어 온 행에 `programApplicationManagerWhere`와 **같은** 판정을 적용한다.
 * 화면에 「수정·취소할 수 있는지」를 알려 주려면 조회 없이 답해야 해서 둘로 나뉘어 있다.
 * 한쪽만 고치면 버튼은 보이는데 누르면 거절당하는(또는 그 반대) 화면이 된다 — 함께 바꾼다.
 */
export function isProgramApplicationManager(
  userId: string,
  application: {
    readonly applicantId: string;
    readonly teamLeaderId: string;
  },
): boolean {
  return (
    application.applicantId === userId || application.teamLeaderId === userId
  );
}

export function programParticipantGithubIds(
  applicantGithubId: bigint,
  team: {
    readonly leader: { readonly githubId: bigint };
    readonly members: readonly {
      readonly user: { readonly githubId: bigint };
    }[];
  } | null,
): readonly bigint[] {
  if (!team) return [applicantGithubId];
  return [
    ...new Set([
      team.leader.githubId,
      ...team.members.map((member) => member.user.githubId),
    ]),
  ];
}
