import { seoulDateTimeValue } from './seoul-date-time';
import { seoulDateTimeSummary } from './program-authoring-manifest';
import type {
  ProgramNoticePatch,
  ProgramNoticePreview,
} from './program-notice-dto';

export type NoticeCurrent = {
  readonly currentName: string;
  readonly currentDescription: string;
  readonly currentOrganizers?: readonly string[];
  readonly applicationStartAt?: string;
  readonly applicationEndAt?: string;
  readonly operationStartAt?: string;
  readonly operationEndAt?: string;
  readonly teamMinSize?: string;
  readonly teamMaxSize?: string;
};

export type NoticeReviewRow = {
  readonly key:
    | 'name'
    | 'organizers'
    | 'applicationPeriod'
    | 'operationPeriod'
    | 'teamSize'
    | 'description';
  readonly label: string;
  readonly current: string;
  readonly next: string | null;
  readonly patch: ProgramNoticePatch;
};

export function noticeReviewRows(
  preview: ProgramNoticePreview,
  current: NoticeCurrent,
): readonly NoticeReviewRow[] {
  const candidates = preview.candidates;
  const application = candidates.applicationPeriod;
  const operation = candidates.operationPeriod;
  const team = candidates.teamSize;
  return [
    {
      key: 'name',
      label: '프로그램명',
      current: current.currentName,
      next: preview.name || null,
      patch: { name: preview.name },
    },
    {
      key: 'organizers',
      label: '주관기관',
      current: current.currentOrganizers?.join(', ') ?? '',
      next: candidates.organizers?.join(', ') || null,
      patch: { organizers: candidates.organizers },
    },
    {
      key: 'applicationPeriod',
      label: '신청 기간',
      current: periodText(current.applicationStartAt, current.applicationEndAt),
      next: application
        ? periodText(
            application.startsAt ?? current.applicationStartAt,
            application.endsAt ?? current.applicationEndAt,
          )
        : null,
      patch: {
        ...(application?.startsAt
          ? { applicationStartAt: localDateTime(application.startsAt) }
          : {}),
        ...(application?.endsAt
          ? { applicationEndAt: localDateTime(application.endsAt) }
          : {}),
      },
    },
    {
      key: 'operationPeriod',
      label: '운영 기간',
      current: periodText(current.operationStartAt, current.operationEndAt),
      next: operation ? periodText(operation.startsAt, operation.endsAt) : null,
      patch: operation
        ? {
            operationStartAt: localDateTime(operation.startsAt),
            operationEndAt: localDateTime(operation.endsAt),
          }
        : {},
    },
    {
      key: 'teamSize',
      label: '인원',
      current: teamText(current.teamMinSize, current.teamMaxSize),
      next: team ? teamText(String(team.min), String(team.max)) : null,
      patch: team
        ? { teamMinSize: String(team.min), teamMaxSize: String(team.max) }
        : {},
    },
    {
      key: 'description',
      label: '소개/설명',
      current: current.currentDescription,
      next: preview.description || null,
      patch: { description: preview.description },
    },
  ];
}

function localDateTime(value: string): string {
  const time = seoulDateTimeValue(value);
  return time === null
    ? ''
    : new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function periodText(start?: string, end?: string): string {
  const format = (value?: string) =>
    value ? seoulDateTimeSummary(localDateTime(value)) : '';
  return start || end ? `${format(start)} ~ ${format(end)}` : '';
}

function teamText(min?: string, max?: string): string {
  return min || max
    ? min === max
      ? `${min}명`
      : `${min || '—'} ~ ${max || '—'}명`
    : '';
}
