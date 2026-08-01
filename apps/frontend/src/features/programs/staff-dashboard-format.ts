import {
  getProgramRecruitmentState,
  type ProgramRecruitmentState,
} from './program-list';
import type { ProgramCategory } from './program-templates';
import type { StaffDashboardProgramSummary } from './types';

export const STAFF_CATEGORY_LABELS = {
  BASIC: '기본',
  SW_VALUE_SPREAD: 'SW 가치확산',
  OSS_CONTEST: 'OSS 경진대회',
  CAPSTONE: '캡스톤',
  SW_CONVERGENCE: 'SW 융합',
  GLOBAL_MAKERTHON: '글로벌 메이커톤',
  CORPORATE_INTERNSHIP: '기업 인턴십',
} satisfies Readonly<Record<ProgramCategory, string>>;

export const STAFF_RECRUITMENT_BADGES = {
  scheduled: { label: '모집 예정', variant: 'pending' },
  recruiting: { label: '모집중', variant: 'recruiting' },
  closed: { label: '마감', variant: 'closed' },
} as const satisfies Readonly<
  Record<
    ProgramRecruitmentState,
    {
      readonly label: string;
      readonly variant: 'pending' | 'recruiting' | 'closed';
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
      category: program.category,
      applicationStartAt: program.applicationPeriod.startsAt,
      applicationEndAt: program.applicationPeriod.endsAt,
      description: '',
    },
    now,
  );
  return STAFF_RECRUITMENT_BADGES[state];
}
