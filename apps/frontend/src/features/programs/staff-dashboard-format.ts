import {
  getProgramRecruitmentState,
  type ProgramRecruitmentState,
} from './program-list';
import {
  PROGRAM_TRACK_TYPE_LABELS,
  type ProgramTrackType,
} from './program-templates';
import type { StaffDashboardProgramSummary } from './types';

export function staffTrackTypeLabel(
  trackType: ProgramTrackType | null,
): string | null {
  if (trackType === null) return null;
  return PROGRAM_TRACK_TYPE_LABELS[trackType];
}

export const STAFF_RECRUITMENT_BADGES = {
  upcoming: { label: '접수대기', variant: 'pending' },
  recruiting: { label: '모집중', variant: 'recruiting' },
  in_progress: { label: '진행중', variant: 'approved' },
  ended: { label: '종료', variant: 'closed' },
} as const satisfies Readonly<
  Record<
    ProgramRecruitmentState,
    {
      readonly label: string;
      readonly variant: 'pending' | 'recruiting' | 'closed' | 'approved';
    }
  >
>;

const DATE_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'Asia/Seoul',
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Seoul',
});

export function formatStaffApplicationPeriod(
  program: StaffDashboardProgramSummary,
): string {
  return `${DATE_FORMATTER.format(new Date(program.applicationPeriod.startsAt))} ~ ${DATE_FORMATTER.format(new Date(program.applicationPeriod.endsAt))}`;
}

export function formatStaffActivityTime(value: string): string {
  return DATE_TIME_FORMATTER.format(new Date(value));
}

export function getStaffRecruitmentBadge(
  program: StaffDashboardProgramSummary,
  now: Date,
): (typeof STAFF_RECRUITMENT_BADGES)[ProgramRecruitmentState] {
  const state = getProgramRecruitmentState(
    {
      id: program.id,
      name: program.name,
      organizer: '',
      trackType: program.trackType,
      applicationStartAt: program.applicationPeriod.startsAt,
      applicationEndAt: program.applicationPeriod.endsAt,
      endAt: null,
      description: '',
    },
    now,
  );
  return STAFF_RECRUITMENT_BADGES[state];
}
