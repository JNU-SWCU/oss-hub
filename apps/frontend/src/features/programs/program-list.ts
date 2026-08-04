import type { ProgramCardStatus } from '@/components/program-card';
import {
  PROGRAM_LIST_STATUS_LABELS,
  type ApplicationStatus,
  type ProgramListItem,
  type ProgramListStatus,
  type ViewerRole,
} from './types';

const SEOUL_TIME_ZONE = 'Asia/Seoul';

/**
 * 카드 배지·클라이언트 그룹용 기간 해석.
 * 저장 상태 없음. backend `deriveProgramListStatus` 와 동일 우선순위:
 * ARCHIVED → endAt < now → upcoming → recruiting → in_progress.
 */
export const PROGRAM_RECRUITMENT_STATES = [
  'upcoming',
  'recruiting',
  'in_progress',
  'ended',
] as const;
export type ProgramRecruitmentState =
  (typeof PROGRAM_RECRUITMENT_STATES)[number];

const PROGRAM_GROUPS = {
  RECRUITING: 'recruiting',
  IN_PROGRESS: 'in-progress',
  UPCOMING: 'upcoming',
  ENDED: 'ended',
} as const;

type ProgramGroupKey = (typeof PROGRAM_GROUPS)[keyof typeof PROGRAM_GROUPS];

export interface ProgramListGroup {
  readonly key: ProgramGroupKey;
  readonly title: string;
  readonly programs: readonly ProgramListItem[];
}

interface FilterProgramsOptions {
  readonly search: string;
  readonly status: ProgramListStatus;
  readonly now: Date;
}

export function getProgramRecruitmentState(
  program: ProgramListItem,
  now: Date,
): ProgramRecruitmentState {
  if (program.lifecycle === 'ARCHIVED') {
    return 'ended';
  }

  const nowTime = now.getTime();
  const start = new Date(program.applicationStartAt).getTime();
  const applyEnd = new Date(program.applicationEndAt).getTime();
  const endAt =
    program.endAt === null ? null : new Date(program.endAt).getTime();

  // backend: endAt IS NOT NULL AND endAt < now → ended (strict <)
  if (endAt !== null && !Number.isNaN(endAt) && endAt < nowTime) {
    return 'ended';
  }
  if (nowTime < start) {
    return 'upcoming';
  }
  if (nowTime <= applyEnd) {
    return 'recruiting';
  }
  return 'in_progress';
}

function yearInSeoul(date: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      timeZone: SEOUL_TIME_ZONE,
    }).format(date),
  );
}

function programYear(program: ProgramListItem): number {
  return yearInSeoul(new Date(program.applicationStartAt));
}

/** programFilter(상태) → 본문 H1. 사이드 패널이 보낸 status와 1:1. */
const PROGRAM_LIST_HEADINGS = {
  all: '프로그램',
  recruiting: '모집중인 프로그램',
  in_progress: '진행중인 프로그램',
  upcoming: '예정된 프로그램',
  ended: '종료된 프로그램',
} as const satisfies Readonly<Record<ProgramListStatus, string>>;

export function getProgramListHeading(status: ProgramListStatus): string {
  return PROGRAM_LIST_HEADINGS[status];
}

/** 페이지 부제 — 교직원/관리자만 다른 문구, 그 외(학생·미배정·비로그인)는 학생용 문구. */
export function getProgramListSubtitle(role: ViewerRole): string {
  if (role === 'STAFF' || role === 'ADMIN') {
    return '내가 운영하는 프로그램과 전체 프로그램입니다';
  }
  return '지금 참여 중이거나 지원할 수 있는 프로그램입니다';
}

/** ProgramCard가 받는 `status`+`badgeText` 한 쌍. 카드 자체의 배지 색·openable은 status로 결정된다. */
export interface ProgramListBadge {
  readonly status: ProgramCardStatus;
  readonly label: string;
}

const RECRUITMENT_STATE_BADGES: Readonly<
  Record<ProgramRecruitmentState, ProgramListBadge>
> = {
  upcoming: { status: 'upcoming', label: PROGRAM_LIST_STATUS_LABELS.upcoming },
  recruiting: {
    status: 'recruiting',
    label: PROGRAM_LIST_STATUS_LABELS.recruiting,
  },
  in_progress: {
    status: 'in_progress',
    label: PROGRAM_LIST_STATUS_LABELS.in_progress,
  },
  ended: { status: 'ended', label: PROGRAM_LIST_STATUS_LABELS.ended },
};

const APPLICATION_STATUS_BADGES: Readonly<
  Record<ApplicationStatus, ProgramListBadge>
> = {
  SUBMITTED: { status: 'pending', label: '승인 대기' },
  APPROVED: { status: 'approved', label: '승인됨' },
  REJECTED: { status: 'rejected', label: '반려됨' },
};

/**
 * 카드 배지. 뷰어 본인 지원 상태(`viewerApplicationStatus`)가 있으면 모집 상태
 * 배지를 덮어쓴다 — 해커톤류 카드에서 학생 본인의 지원 결과가 우선한다.
 * 없으면(교직원, 또는 지원 절차가 없는 프로그램) 시간 기반 모집 상태를 그대로 쓴다.
 * 반환된 `status`는 그대로 `ProgramCard`의 `status`(openable 판정까지 겸함)로 넘긴다.
 */
export function getProgramListBadge(
  program: ProgramListItem,
  now: Date,
): ProgramListBadge {
  if (program.viewerApplicationStatus) {
    return APPLICATION_STATUS_BADGES[program.viewerApplicationStatus];
  }
  return RECRUITMENT_STATE_BADGES[getProgramRecruitmentState(program, now)];
}

function matchesStatus(
  program: ProgramListItem,
  status: ProgramListStatus,
  now: Date,
): boolean {
  if (status === 'all') return true;
  return getProgramRecruitmentState(program, now) === status;
}

/**
 * 서버가 이미 status로 걸렀을 때도 호출부 호환을 위해 유지.
 * all일 때 상태별 섹션으로 묶는다.
 */
export function filterAndGroupPrograms(
  programs: readonly ProgramListItem[],
  options: FilterProgramsOptions,
): readonly ProgramListGroup[] {
  const search = options.search.trim().toLocaleLowerCase('ko');
  const filtered = programs
    .filter((program) => program.name.toLocaleLowerCase('ko').includes(search))
    .filter((program) => matchesStatus(program, options.status, options.now));

  // 특정 필터면 한 섹션으로만 보여 제목이 필터와 겹치지 않게 한다.
  if (options.status !== 'all') {
    if (filtered.length === 0) return [];
    const titleByStatus = {
      recruiting: PROGRAM_LIST_STATUS_LABELS.recruiting,
      in_progress: PROGRAM_LIST_STATUS_LABELS.in_progress,
      upcoming: PROGRAM_LIST_STATUS_LABELS.upcoming,
      ended: PROGRAM_LIST_STATUS_LABELS.ended,
    } as const;
    return [
      {
        key:
          options.status === 'recruiting'
            ? PROGRAM_GROUPS.RECRUITING
            : options.status === 'in_progress'
              ? PROGRAM_GROUPS.IN_PROGRESS
              : options.status === 'upcoming'
                ? PROGRAM_GROUPS.UPCOMING
                : PROGRAM_GROUPS.ENDED,
        title: titleByStatus[options.status],
        programs: filtered,
      },
    ];
  }

  const groups: readonly ProgramListGroup[] = [
    {
      key: PROGRAM_GROUPS.RECRUITING,
      title: PROGRAM_LIST_STATUS_LABELS.recruiting,
      programs: filtered.filter(
        (program) =>
          getProgramRecruitmentState(program, options.now) === 'recruiting',
      ),
    },
    {
      key: PROGRAM_GROUPS.IN_PROGRESS,
      title: PROGRAM_LIST_STATUS_LABELS.in_progress,
      programs: filtered.filter(
        (program) =>
          getProgramRecruitmentState(program, options.now) === 'in_progress',
      ),
    },
    {
      key: PROGRAM_GROUPS.UPCOMING,
      title: PROGRAM_LIST_STATUS_LABELS.upcoming,
      programs: filtered.filter(
        (program) =>
          getProgramRecruitmentState(program, options.now) === 'upcoming',
      ),
    },
    {
      key: PROGRAM_GROUPS.ENDED,
      title: PROGRAM_LIST_STATUS_LABELS.ended,
      programs: filtered.filter(
        (program) =>
          getProgramRecruitmentState(program, options.now) === 'ended',
      ),
    },
  ];

  return groups.filter((group) => group.programs.length > 0);
}

/** 테스트·정렬 헬퍼 — 서울 연도 (과거 그룹 제거 후에도 export 유지 불필요 시 내부만) */
export function programStartYear(program: ProgramListItem): number {
  return programYear(program);
}
