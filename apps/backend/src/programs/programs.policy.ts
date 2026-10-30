import {
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { parseGithubRepositoryUrl } from '../github/github-repository-url.policy';
import { ApplicationStatus } from '@prisma/client';

@ValidatorConstraint({ name: 'githubRepositoryUrl', async: false })
export class GithubRepositoryUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      typeof value === 'string' && parseGithubRepositoryUrl(value) !== null
    );
  }
}

const SEOUL_TIME_ZONE = 'Asia/Seoul';

function calendarDayNumber(value: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SEOUL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function programDeadline(
  dueAt: Date,
  now: Date,
): {
  readonly dDay: number;
  readonly label: string;
} {
  const dDay = calendarDayNumber(dueAt) - calendarDayNumber(now);
  const label = dDay < 0 ? '마감 지남' : dDay === 0 ? '오늘 마감' : `D-${dDay}`;
  return { dDay, label };
}

export function hasProgramDeadlinePassed(dueAt: Date, now: Date): boolean {
  return now.getTime() > dueAt.getTime();
}

export type ProgramDeletionScopeCounts = {
  readonly applications: number;
  readonly teams: number;
  readonly boardPosts: number;
  readonly submissions: number;

  readonly submissionEvents: number;

  readonly scopeFingerprint: string;
};

export function sameProgramDeletionScopeCounts(
  left: ProgramDeletionScopeCounts,
  right: ProgramDeletionScopeCounts,
): boolean {
  return (
    left.applications === right.applications &&
    left.teams === right.teams &&
    left.boardPosts === right.boardPosts &&
    left.submissions === right.submissions &&
    left.submissionEvents === right.submissionEvents &&
    left.scopeFingerprint === right.scopeFingerprint
  );
}

export function sameProgramDeletionScopeCountValues(
  left: ProgramDeletionScopeCounts,
  right: Omit<ProgramDeletionScopeCounts, 'scopeFingerprint'>,
): boolean {
  return (
    left.applications === right.applications &&
    left.teams === right.teams &&
    left.boardPosts === right.boardPosts &&
    left.submissions === right.submissions &&
    left.submissionEvents === right.submissionEvents
  );
}

const PROGRAM_END_AT_UNDECIDED_TIME = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

export function isProgramEndAtUndecided(value: Date): boolean {
  return value.getTime() === PROGRAM_END_AT_UNDECIDED_TIME;
}

const PROGRAM_LIST_QUERY_STATUSES = [
  'all',
  'current',
  'recruiting',
  'in_progress',
  'upcoming',
  'ended',
] as const;

type ProgramListQueryStatus = (typeof PROGRAM_LIST_QUERY_STATUSES)[number];

const PROGRAM_LIST_QUERY_SORTS = [
  'name',
  'applicationPeriod',
  'status',
] as const;

type ProgramListQuerySort = (typeof PROGRAM_LIST_QUERY_SORTS)[number];

const PROGRAM_LIST_QUERY_DIRECTIONS = ['asc', 'desc'] as const;

type ProgramListQueryDirection = (typeof PROGRAM_LIST_QUERY_DIRECTIONS)[number];

interface ProgramListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: ProgramListQueryStatus;
  readonly year?: number;

  readonly sort?: ProgramListQuerySort;

  readonly direction?: ProgramListQueryDirection;
}

export {
  PROGRAM_LIST_QUERY_DIRECTIONS,
  PROGRAM_LIST_QUERY_SORTS,
  PROGRAM_LIST_QUERY_STATUSES,
  type ProgramListQuery,
  type ProgramListQueryDirection,
  type ProgramListQuerySort,
  type ProgramListQueryStatus,
};

export type ProgramStatusCounts = {
  readonly all: number;
  readonly recruiting: number;
  readonly in_progress: number;
  readonly upcoming: number;
  readonly ended: number;
};

export function emptyProgramStatusCounts(): ProgramStatusCounts {
  return {
    all: 0,
    recruiting: 0,
    in_progress: 0,
    upcoming: 0,
    ended: 0,
  };
}

export function isProgramApplicationManager(
  userId: string,
  application: { readonly teamLeaderId: string },
): boolean {
  return application.teamLeaderId === userId;
}

export function canEditStudentRepositoryUrl(
  context: {
    readonly status: ApplicationStatus;
    readonly endAt: Date;
    readonly isManager: boolean;
  },
  now: Date,
): boolean {
  return (
    context.isManager &&
    context.status === ApplicationStatus.APPROVED &&
    now < context.endAt
  );
}

export type TeamDeletionScopeCounts = {
  readonly applications: number;
  readonly members: number;
  readonly invitations: number;
  readonly submissions: number;

  readonly submissionEvents: number;

  readonly detachedRepositories: number;

  readonly scopeFingerprint: string;
};

export function sameTeamDeletionScopeCounts(
  left: TeamDeletionScopeCounts,
  right: TeamDeletionScopeCounts,
): boolean {
  return (
    sameTeamDeletionScopeCountValues(left, right) &&
    left.scopeFingerprint === right.scopeFingerprint
  );
}

export function sameTeamDeletionScopeCountValues(
  left: TeamDeletionScopeCounts,
  right: Omit<TeamDeletionScopeCounts, 'scopeFingerprint'>,
): boolean {
  return (
    left.applications === right.applications &&
    left.members === right.members &&
    left.invitations === right.invitations &&
    left.submissions === right.submissions &&
    left.submissionEvents === right.submissionEvents &&
    left.detachedRepositories === right.detachedRepositories
  );
}
