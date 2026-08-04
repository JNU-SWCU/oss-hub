import type { ProgramListItem, ProgramListStatus } from './types';

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
  program: Pick<
    ProgramListItem,
    'lifecycle' | 'applicationStartAt' | 'applicationEndAt' | 'endAt'
  >,
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
      recruiting: '모집중',
      in_progress: '진행중',
      upcoming: '접수대기',
      ended: '종료',
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
      title: '모집중',
      programs: filtered.filter(
        (program) =>
          getProgramRecruitmentState(program, options.now) === 'recruiting',
      ),
    },
    {
      key: PROGRAM_GROUPS.IN_PROGRESS,
      title: '진행중',
      programs: filtered.filter(
        (program) =>
          getProgramRecruitmentState(program, options.now) === 'in_progress',
      ),
    },
    {
      key: PROGRAM_GROUPS.UPCOMING,
      title: '접수대기',
      programs: filtered.filter(
        (program) =>
          getProgramRecruitmentState(program, options.now) === 'upcoming',
      ),
    },
    {
      key: PROGRAM_GROUPS.ENDED,
      title: '종료',
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
