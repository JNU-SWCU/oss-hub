import type { ProgramCardStatus } from './program-card';
import {
  PROGRAM_LIST_STATUS_LABELS,
  type ApplicationStatus,
  type ProgramListItem,
  type ProgramListStatus,
  type ViewerRole,
} from './types';

const SEOUL_TIME_ZONE = 'Asia/Seoul';

export const PROGRAM_RECRUITMENT_STATES = [
  'upcoming',
  'recruiting',
  'in_progress',
  'ended',
] as const;
export type ProgramRecruitmentState =
  (typeof PROGRAM_RECRUITMENT_STATES)[number];

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

export function getProgramListSubtitle(role: ViewerRole): string {
  if (role === 'STAFF' || role === 'ADMIN') {
    return '내가 운영하는 프로그램과 전체 프로그램입니다';
  }
  return '지금 참여 중이거나 지원할 수 있는 프로그램입니다';
}

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
  SUBMITTED: { status: 'pending', label: '신청' },
  APPROVED: { status: 'approved', label: '신청' },
  REJECTED: { status: 'rejected', label: '반려' },
};

export function getProgramListBadge(
  program: ProgramListItem,
  now: Date,
): ProgramListBadge {
  if (program.viewerApplicationStatus) {
    return APPLICATION_STATUS_BADGES[program.viewerApplicationStatus];
  }
  return RECRUITMENT_STATE_BADGES[getProgramRecruitmentState(program, now)];
}

export function programStartYear(program: ProgramListItem): number {
  return programYear(program);
}
