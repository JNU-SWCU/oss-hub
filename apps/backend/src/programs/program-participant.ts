import type { Prisma } from '@prisma/client';

/**
 * 신청서를 **읽을 수 있는** 사람 — 지금 그 팀에 속해 있는 사람뿐이다.
 *
 * ⚠ `Application.applicantId`는 **누가 처음 냈는지의 기록**이지 권한이 아니다.
 * 신청 뒤에도 팀원 제외·본인 탈퇴·팀장 자동 승계가 일어나므로, 신청자 절을 남겨 두면
 * 팀을 떠난 사람이 옛 팀의 신청서(답변·반려 사유)를 계속 읽는다. 기록은 바꾸지 않고
 * 권한만 현재 `TeamMember` 행에서 읽는다 — 그 행이 「지금 참여 중」의 유일한 원본이다.
 * 팀장도 항상 자기 팀의 `TeamMember` 행을 갖고(생성 시 함께 만든다) 개인 신청도 1인 팀이라(D5)
 * 이 한 절이 모든 참여자를 담는다. 판정 알림 수신자(#570)도 같은 집합이어야 한다.
 */
export function programApplicationParticipantWhere(
  userId: string,
): Prisma.ApplicationWhereInput {
  return {
    team: { members: { some: { userId } } },
  };
}

/**
 * 신청서를 **바꿀 수 있는** 사람 — 지금 그 팀의 팀장인 사람뿐이다.
 *
 * ⚠ 읽기(`programApplicationParticipantWhere`)보다 좁다. 읽기가 팀원 전원을 담는 것은
 * 의도된 범위지만(#570 판정 알림 수신자와 같은 집합) 쓰기까지 정당화하지 않는다.
 * 같은 조건을 재사용하면 팀원 아무나 팀 전체의 신청을 고치거나 하드 삭제할 수 있다(#1083).
 *
 * ⚠ `leaderId`만으로도 좁아 보이지만 멤버십 절을 함께 요구한다 — 팀장 승계는 `Team.leaderId`와
 * `TeamMember` 집합을 함께 옮기므로, 둘 중 하나만 보는 조건은 그 사이 상태에서 갈린다.
 * 두 절을 같은 `team` 관계 안에 두어 **같은 팀 행 하나**에 대해 판정한다.
 */
export function programApplicationManagerWhere(
  userId: string,
): Prisma.ApplicationWhereInput {
  return {
    team: { leaderId: userId, members: { some: { userId } } },
  };
}

/**
 * 이미 읽어 온 행에 `programApplicationManagerWhere`와 **같은** 판정을 적용한다.
 * 화면에 「수정·취소할 수 있는지」를 알려 주려면 조회 없이 답해야 해서 둘로 나뉘어 있다.
 * 한쪽만 고치면 버튼은 보이는데 누르면 거절당하는(또는 그 반대) 화면이 된다 — 함께 바꾼다.
 *
 * 호출부는 **멤버십으로 좁힌 조회의 결과 행**만 넘긴다. 그 조회가 이미 「지금 이 팀 사람인가」를
 * 답했으므로 여기서는 팀장인지만 본다. 신청자 id는 받지 않는다 — 표시용 기록일 뿐이라
 * 인자로 두면 다시 권한처럼 쓰이게 된다.
 */
export function isProgramApplicationManager(
  userId: string,
  application: { readonly teamLeaderId: string },
): boolean {
  return application.teamLeaderId === userId;
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
