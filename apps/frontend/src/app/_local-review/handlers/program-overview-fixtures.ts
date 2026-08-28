import type { ProgramOverview } from '@/features/programs/program-overview-api';
import {
  MY_TEAM_FIXTURES,
  type PublicProgramId,
} from './student-program-fixtures';

/**
 * `programs/:programId/overview` 픽스처.
 *
 * 프로토타입 규모 수치(188명 참여·47팀·47개 연결 저장소, 내 제출 2·3서류)를
 * 캡스톤 기준으로 반영한다. viewer* 세 필드는 실제 DTO처럼 역할별로 한쪽만
 * 채운다 — 학생은 `viewerDocuments*`, 교직원·관리자는 `fullySubmittedParticipantCount`.
 */
interface ProgramOverviewBase {
  readonly name: string;
  readonly category: string;
  readonly lifecycle: string;
  readonly milestoneCount: number;
  readonly boardPostCount: number;
  readonly participantCount: number;
  readonly teamCount: number;
  readonly connectedRepositoryCount: number;
  readonly studentDocumentsCompleted: number;
  readonly studentDocumentsTotal: number;
  readonly fullySubmittedParticipantCount: number;
  /** 남은 마감 마일스톤 — 좌측 패널 카운트다운 확인용. */
  readonly remainingMilestones: readonly {
    readonly label: string;
    readonly dueAt: string;
  }[];
  /** 서류가 있는 마일스톤 — 좌측 패널 depth-1 자식 확인용. */
  readonly milestoneDocuments: readonly {
    readonly milestoneId: string;
    readonly title: string;
    readonly studentCompleted: number;
    readonly studentTotal: number;
    readonly staffCompleted: number;
  }[];
}

const PROGRAM_OVERVIEW_BASES: Readonly<
  Record<PublicProgramId, ProgramOverviewBase>
> = {
  'program-capstone': {
    name: '합성 캡스톤 2026',
    category: 'CAPSTONE',
    lifecycle: 'PUBLISHED',
    milestoneCount: 3,
    boardPostCount: 3,
    participantCount: 188,
    teamCount: 47,
    connectedRepositoryCount: 47,
    // milestone-document-fixtures.ts의 3개 서류 중 2개(승인·보완요청)가
    // "제출됨"에 해당한다 — student-program-fixtures.ts의 마일스톤별
    // viewerSubmissionStatus와 앞뒤가 맞아야 한다.
    studentDocumentsCompleted: 2,
    studentDocumentsTotal: 3,
    remainingMilestones: [
      {
        label: '중간 보고',
        dueAt: '2026-09-01T09:00:00.000Z',
      },
      {
        label: '최종 결과 요약',
        dueAt: '2026-09-12T09:00:00.000Z',
      },
    ],
    milestoneDocuments: [
      {
        milestoneId: 'milestones-approved',
        title: '기획서 제출',
        studentCompleted: 1,
        studentTotal: 1,
        staffCompleted: 31,
      },
      {
        milestoneId: 'milestones-revision',
        title: '중간 보고',
        studentCompleted: 1,
        studentTotal: 1,
        staffCompleted: 12,
      },
      {
        milestoneId: 'milestones-overdue',
        title: '최종 결과 요약',
        studentCompleted: 0,
        studentTotal: 1,
        staffCompleted: 0,
      },
    ],
    fullySubmittedParticipantCount: 96,
  },
  'program-oss-contest': {
    name: '합성 OSS 경진대회',
    category: 'OSS_CONTEST',
    lifecycle: 'PUBLISHED',
    milestoneCount: 2,
    boardPostCount: 1,
    participantCount: 24,
    teamCount: 8,
    connectedRepositoryCount: 8,
    // milestone-document-fixtures.ts의 2개 서류 중 예선(CHANGES_REQUESTED)만
    // "제출됨" — student-program-fixtures.ts의 viewerSubmissionStatus와 맞춘다.
    studentDocumentsCompleted: 1,
    studentDocumentsTotal: 2,
    remainingMilestones: [
      { label: '예선 제출', dueAt: '2026-09-20T09:00:00.000Z' },
    ],
    milestoneDocuments: [
      {
        milestoneId: 'milestones-contest-final',
        title: '예선 제출',
        studentCompleted: 1,
        studentTotal: 2,
        staffCompleted: 5,
      },
    ],
    fullySubmittedParticipantCount: 5,
  },
  'program-basic-study': {
    name: '합성 기초 오픈소스 스터디',
    category: 'BASIC',
    lifecycle: 'PUBLISHED',
    milestoneCount: 2,
    boardPostCount: 0,
    participantCount: 3,
    teamCount: 0,
    // 교직원 대시보드 카드의 `activity.repositories` 와 같은 수여야 한다 — 백엔드에서
    // 앞의 것은 프로그램에 걸린 저장소 링크 수이고 이것은 `Repository.count({programId})`
    // 라 앞의 것이 이것을 넘을 수 없다. 카드가 2인데 여기가 1이면 실제 서버가 만들 수 없는
    // 상태를 두 교직원 화면이 서로 다르게 보여 준다. 공개 전환 신청이 늘며 저장소도 하나
    // 늘었다(#753).
    connectedRepositoryCount: 2,
    // 신청 전 상태라 두 서류 모두 미제출이다(student-program-fixtures.ts BASIC_MILESTONES).
    studentDocumentsCompleted: 0,
    studentDocumentsTotal: 2,
    remainingMilestones: [],
    milestoneDocuments: [
      {
        milestoneId: 'milestones-basic-intro',
        title: '스터디 계획서',
        studentCompleted: 0,
        studentTotal: 1,
        staffCompleted: 0,
      },
      {
        milestoneId: 'milestones-basic-final',
        title: '스터디 결과 보고',
        studentCompleted: 0,
        studentTotal: 1,
        staffCompleted: 0,
      },
    ],
    fullySubmittedParticipantCount: 1,
  },
  // 신청이 반려된 프로그램. 이 학생은 참여자가 아니므로 참여·팀·저장소가 모두 0이고
  // 서류도 생기지 않는다 — 승인되지 않은 신청에는 제출 대상이 없다.
  'program-sw-value': {
    name: '합성 SW가치확산 프로그램',
    category: 'SW_VALUE_SPREAD',
    lifecycle: 'PUBLISHED',
    milestoneCount: 1,
    boardPostCount: 0,
    participantCount: 0,
    teamCount: 0,
    connectedRepositoryCount: 0,
    studentDocumentsCompleted: 0,
    studentDocumentsTotal: 0,
    remainingMilestones: [],
    milestoneDocuments: [],
    fullySubmittedParticipantCount: 0,
  },
};

export function programOverviewFor(
  programId: PublicProgramId,
  role: 'STUDENT' | 'STAFF' | 'ADMIN',
): ProgramOverview {
  const base = PROGRAM_OVERVIEW_BASES[programId];
  const isStudent = role === 'STUDENT';
  return {
    programId,
    name: base.name,
    category: base.category,
    lifecycle: base.lifecycle,
    milestoneCount: base.milestoneCount,
    boardPostCount: base.boardPostCount,
    participantCount: base.participantCount,
    teamCount: base.teamCount,
    connectedRepositoryCount: base.connectedRepositoryCount,
    viewerRole: role,
    viewerDocumentsCompleted: isStudent ? base.studentDocumentsCompleted : null,
    viewerDocumentsTotal: isStudent ? base.studentDocumentsTotal : null,
    fullySubmittedParticipantCount: isStudent
      ? null
      : base.fullySubmittedParticipantCount,
    remainingMilestones: base.remainingMilestones,
    // 분자·분모의 의미가 역할로 갈린다 — 학생은 내 서류 수, 교직원은 완주 팀 수.
    milestoneDocuments: base.milestoneDocuments.map((entry) => ({
      milestoneId: entry.milestoneId,
      title: entry.title,
      completed: isStudent ? entry.studentCompleted : entry.staffCompleted,
      total: isStudent ? entry.studentTotal : base.teamCount,
    })),
  } satisfies ProgramOverview;
}

export interface ProgramOverviewTeamMemberFixture {
  readonly userId: string;
  readonly displayName: string;
  /** GitHub 로그인. 공개 로스터는 이것을 표시명으로 쓰고, 교직원 목록은 실명과 함께 쓴다. */
  readonly nickname: string;
  readonly isLeader: boolean;
}

/** `programs/:programId/overview/teams`가 돌려주는 팀 명단 항목 하나. */
export interface ProgramOverviewTeamFixture {
  readonly teamId: string;
  readonly name: string;
  readonly memberCount: number;
  readonly members: readonly ProgramOverviewTeamMemberFixture[];
}

const TEAM_MEMBER_SIZE_CYCLE = [2, 3, 4] as const;

/** 47팀 규모를 흉내 내려고 절차적으로 팀을 만든다(fixture-response.ts의 감사 로그 생성과 같은 방식). */
function generateSyntheticTeams(
  slug: string,
  label: string,
  startNumber: number,
  count: number,
): readonly ProgramOverviewTeamFixture[] {
  return Array.from({ length: count }, (_, index) => {
    const teamNumber = startNumber + index;
    const memberCount =
      TEAM_MEMBER_SIZE_CYCLE[index % TEAM_MEMBER_SIZE_CYCLE.length] ?? 2;
    return {
      teamId: `synthetic-team-${slug}-${teamNumber}`,
      name: `합성 ${label} ${teamNumber}팀`,
      memberCount,
      members: Array.from({ length: memberCount }, (_, memberIndex) => ({
        userId: `synthetic-user-${slug}-${teamNumber}-${memberIndex + 1}`,
        displayName: `합성 참여자 ${teamNumber}-${memberIndex + 1}`,
        nickname: `${slug}-${teamNumber}-${memberIndex + 1}`,
        isLeader: memberIndex === 0,
      })),
    };
  });
}

/**
 * 내 팀이 명단 첫 자리에도 그대로 나와야 화면이 "내 팀" 배지를 붙일 수 있다
 * (program-teams-page.tsx가 `teamId === myTeamId`로 대조한다). student-program-fixtures.ts의
 * `MY_TEAM_FIXTURES['program-capstone']`와 멤버 단위로 정확히 같아야 한다.
 */
const CAPSTONE_MY_TEAM_ENTRY: ProgramOverviewTeamFixture = (() => {
  const myTeam = MY_TEAM_FIXTURES['program-capstone'];
  return {
    teamId: myTeam.id,
    name: myTeam.name,
    memberCount: myTeam.memberCount,
    members: myTeam.members.map((member) => ({
      userId: member.userId,
      displayName: member.name ?? member.nickname,
      nickname: member.nickname,
      isLeader: member.isLeader,
    })),
  };
})();

const PROGRAM_TEAM_DIRECTORIES: Readonly<
  Record<PublicProgramId, readonly ProgramOverviewTeamFixture[]>
> = {
  // 내 팀 1개 + 합성 팀 46개 = 47팀(팩트 바 teamCount와 일치).
  'program-capstone': [
    CAPSTONE_MY_TEAM_ENTRY,
    ...generateSyntheticTeams('capstone', '캡스톤', 2, 46),
  ],
  'program-oss-contest': generateSyntheticTeams('contest', '경진대회', 1, 8),
  // 개인형 프로그램이라 팀이 없다.
  'program-basic-study': [],
  'program-sw-value': [],
};

/** `programs/:programId/teams`(교직원 전용)가 돌려주는 팀 항목 하나. */
export interface StaffProgramTeamFixture {
  readonly teamId: string;
  readonly name: string;
  readonly memberCount: number;
  readonly members: readonly {
    readonly userId: string;
    readonly name: string | null;
    readonly nickname: string;
    readonly isLeader: boolean;
  }[];
}

/**
 * 교직원 팀 목록은 공개 로스터와 **같은 팀 집합**을 실명까지 붙여 돌려준다.
 * 두 벌로 적으면 한쪽만 고쳐져 사이드바 팀 수와 목록이 어긋나므로 여기서 파생시킨다.
 *
 * 마지막 팀의 팀장은 `name: null`로 둔다 — 프로필을 아직 채우지 않은 계정이 섞였을
 * 때 화면이 GitHub 계정으로 떨어지는지 검토자가 눈으로 볼 수 있어야 한다.
 */
export function staffProgramTeamDirectoryFor(
  programId: PublicProgramId,
): readonly StaffProgramTeamFixture[] {
  const teams = PROGRAM_TEAM_DIRECTORIES[programId];
  return teams.map((team, teamIndex) => ({
    teamId: team.teamId,
    name: team.name,
    memberCount: team.memberCount,
    members: team.members.map((member, memberIndex) => ({
      userId: member.userId,
      name:
        teamIndex === teams.length - 1 && memberIndex === 0
          ? null
          : member.displayName,
      nickname: member.nickname,
      isLeader: member.isLeader,
    })),
  }));
}

export function programTeamDirectoryFor(
  programId: PublicProgramId,
): readonly ProgramOverviewTeamFixture[] {
  return PROGRAM_TEAM_DIRECTORIES[programId];
}
