import type { ProgramListItem, ProgramListStatus } from './types';

const PROGRAM_GROUPS = {
  CURRENT_RECRUITING: 'current-recruiting',
  CURRENT_CLOSED: 'current-closed',
  PAST: 'past',
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

export function isProgramRecruiting(
  program: ProgramListItem,
  now: Date,
): boolean {
  return new Date(program.applicationEndAt).getTime() >= now.getTime();
}

function programYear(program: ProgramListItem): number {
  return new Date(program.applicationStartAt).getFullYear();
}

function matchesStatus(
  program: ProgramListItem,
  status: ProgramListStatus,
  now: Date,
): boolean {
  if (status === 'all') return true;
  if (status === 'recruiting') return isProgramRecruiting(program, now);
  return !isProgramRecruiting(program, now);
}

function comparePrograms(
  left: ProgramListItem,
  right: ProgramListItem,
): number {
  const byStartDate =
    new Date(right.applicationStartAt).getTime() -
    new Date(left.applicationStartAt).getTime();
  return byStartDate === 0
    ? left.name.localeCompare(right.name, 'ko')
    : byStartDate;
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
  const currentYear = options.now.getFullYear();

  const groups: readonly ProgramListGroup[] = [
    {
      key: PROGRAM_GROUPS.CURRENT_RECRUITING,
      title: '올해 진행 중',
      programs: filtered.filter(
        (program) =>
          programYear(program) >= currentYear &&
          isProgramRecruiting(program, options.now),
      ),
    },
    {
      key: PROGRAM_GROUPS.CURRENT_CLOSED,
      title: '종료',
      programs: filtered.filter(
        (program) =>
          programYear(program) === currentYear &&
          !isProgramRecruiting(program, options.now),
      ),
    },
    {
      key: PROGRAM_GROUPS.PAST,
      title: '과거 연도',
      programs: filtered.filter(
        (program) => programYear(program) < currentYear,
      ),
    },
  ];

  return groups.filter((group) => group.programs.length > 0);
}
