import { SUBMISSION_STATUS_LABELS } from '@/lib/status-vocabulary';
import type { ProgramDetail, SubmissionStatus } from './types';
import {
  PROGRAM_TRACK_TYPE_LABELS,
  type ProgramTrackType,
} from './program-templates';

const DATE_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function trackTypeLabel(trackType: ProgramTrackType): string {
  return PROGRAM_TRACK_TYPE_LABELS[trackType];
}

export function programDetailMeta(
  program: Pick<ProgramDetail, 'organizer' | 'trackType' | 'applicationPeriod'>,
): { readonly context: string; readonly period: string } {
  const context =
    program.trackType === null
      ? program.organizer
      : `${program.organizer} · ${trackTypeLabel(program.trackType)}`;
  const period = `신청 기간 ${formatSeoulDateOnly(program.applicationPeriod.startsAt)} ~ ${formatSeoulDateOnly(program.applicationPeriod.endsAt)}`;
  return { context, period };
}

export function submissionLabel(status: SubmissionStatus): string {
  return SUBMISSION_STATUS_LABELS[status];
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

function formatSeoulDateOnly(value: string): string {
  const { year, month, day } = seoulParts(value);
  return `${year}.${month}.${day}`;
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
