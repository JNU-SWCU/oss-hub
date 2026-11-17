import type { ProgramDetail } from './dto';
import {
  PROGRAM_TRACK_TYPE_LABELS,
  programOrganizersLabel,
  type ProgramTrackType,
} from '../program-contract';

const DATE_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export type MilestoneCountdownTone = 'ahead' | 'soon' | 'closed';

export function milestoneCountdown(
  dDay: number,
  pastDue: boolean,
): { readonly label: string; readonly tone: MilestoneCountdownTone } {
  if (pastDue || dDay < 0) return { label: '마감', tone: 'closed' };
  if (dDay === 0) return { label: 'D-Day', tone: 'soon' };
  return { label: `D-${dDay}`, tone: dDay <= 3 ? 'soon' : 'ahead' };
}

function trackTypeLabel(trackType: ProgramTrackType): string {
  return PROGRAM_TRACK_TYPE_LABELS[trackType];
}

export function programDetailContext(
  program: Pick<ProgramDetail, 'organizers' | 'trackType'>,
): string {
  const organizers = programOrganizersLabel(program.organizers);
  return program.trackType === null
    ? organizers
    : `${organizers} · ${trackTypeLabel(program.trackType)}`;
}

export function formatSeoulDate(value: string): string {
  return DATE_FORMAT.format(new Date(value));
}

export function isPastDue(value: string, now: number = Date.now()): boolean {
  const dueAt = new Date(value).getTime();
  return Number.isFinite(dueAt) && now > dueAt;
}

const SEOUL_PARTS_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function seoulParts(value: string): Record<string, string> {
  const parts = SEOUL_PARTS_FORMAT.formatToParts(new Date(value));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function formatSeoulDateRange(
  startsAt: string,
  endsAt: string,
  formatEnd: (endsAt: string, format: (value: string) => string) => string = (
    value,
    format,
  ) => format(value),
): string {
  const start = seoulParts(startsAt);
  const end = formatEnd(endsAt, (value) => {
    const { year, month, day } = seoulParts(value);
    return year === start.year ? `${month}.${day}` : `${year}.${month}.${day}`;
  });
  return `${start.year}.${start.month}.${start.day} ~ ${end}`;
}

export function formatSeoulShortDateTime(value: string): string {
  const { month, day, hour, minute } = seoulParts(value);
  return `${month}.${day} ${hour}:${minute}`;
}

export function formatSeoulShortRange(startAt: string, dueAt: string): string {
  const start = seoulParts(startAt);
  const due = seoulParts(dueAt);
  return `${start.year.slice(-2)}.${start.month}.${start.day} – ${due.year.slice(-2)}.${due.month}.${due.day} ${due.hour}:${due.minute}`;
}
