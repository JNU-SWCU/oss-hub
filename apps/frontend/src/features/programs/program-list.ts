import type { ProgramListItem, ProgramListStatus } from './types';

const SEOUL_TIME_ZONE = 'Asia/Seoul';

const PROGRAM_GROUPS = {
  SCHEDULED: 'scheduled',
  CURRENT_RECRUITING: 'current-recruiting',
  CURRENT_CLOSED: 'current-closed',
  PAST: 'past',
} as const;

export const PROGRAM_RECRUITMENT_STATES = [
  'scheduled',
  'recruiting',
  'closed',
] as const;
export type ProgramRecruitmentState =
  (typeof PROGRAM_RECRUITMENT_STATES)[number];

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
  const nowTime = now.getTime();
  if (nowTime < new Date(program.applicationStartAt).getTime()) {
    return 'scheduled';
  }
  if (nowTime <= new Date(program.applicationEndAt).getTime()) {
    return 'recruiting';
  }
  return 'closed';
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

function comparePrograms(
  left: ProgramListItem,
  right: ProgramListItem,
): number {
  const byStartDate =
    new Date(right.applicationStartAt).getTime() -
    new Date(left.applicationStartAt).getTime();
  if (byStartDate !== 0) return byStartDate;

  const byName = left.name.localeCompare(right.name, 'ko');
  return byName !== 0 ? byName : left.id.localeCompare(right.id);
}

export function filterAndGroupPrograms(
  programs: readonly ProgramListItem[],
  options: FilterProgramsOptions,
): readonly ProgramListGroup[] {
  const search = options.search.trim().toLocaleLowerCase('ko');
  const filtered = programs
    .filter((program) => program.name.toLocaleLowerCase('ko').includes(search))
    .filter((program) => matchesStatus(program, options.status, options.now))
    .sort(comparePrograms);
  const currentYear = yearInSeoul(options.now);

  const groups: readonly ProgramListGroup[] = [
    {
      key: PROGRAM_GROUPS.SCHEDULED,
      title: '모집 예정',
      programs: filtered.filter(
        (program) =>
          getProgramRecruitmentState(program, options.now) === 'scheduled',
      ),
    },
    {
      key: PROGRAM_GROUPS.CURRENT_RECRUITING,
      title: '올해 진행 중',
      programs: filtered.filter(
        (program) =>
          programYear(program) === currentYear &&
          getProgramRecruitmentState(program, options.now) === 'recruiting',
      ),
    },
    {
      key: PROGRAM_GROUPS.CURRENT_CLOSED,
      title: '종료',
      programs: filtered.filter(
        (program) =>
          programYear(program) === currentYear &&
          getProgramRecruitmentState(program, options.now) === 'closed',
      ),
    },
    {
      key: PROGRAM_GROUPS.PAST,
      title: '과거 연도',
      programs: filtered.filter(
        (program) =>
          programYear(program) < currentYear &&
          getProgramRecruitmentState(program, options.now) === 'closed',
      ),
    },
  ];

  return groups.filter((group) => group.programs.length > 0);
}
