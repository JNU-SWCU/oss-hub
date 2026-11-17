import { Injectable } from '@nestjs/common';
import type { ProgramNoticeCandidates } from './program-notice.types';
import {
  PROGRAM_ORGANIZER_MAX_LENGTH,
  PROGRAM_ORGANIZERS_MAX_COUNT,
} from './program-organizers.config';

@Injectable()
export class ProgramNoticeCandidatesClient {
  extract(description: string): ProgramNoticeCandidates {
    let result: ProgramNoticeCandidates = {};
    const organizers: string[] = [];
    for (const raw of description.split('\n')) {
      const line = raw.replace(/^\s*(?:\d+[.)]|[•○ㅇ\-※])\s*/, '').trim();
      const organizer = line.match(
        /^(?:공동\s*)?(?:주최|주관)(?:\s*기관)?\s*[:：]\s*(.+)$/,
      );
      if (organizer?.[1]) {
        const names = organizer[1]
          .split(/[,，·/]/)
          .map((name) => name.trim())
          .filter(Boolean);
        if (names.every((name) => name.length <= PROGRAM_ORGANIZER_MAX_LENGTH))
          organizers.push(...names);
      }
      const application = line.match(
        /^(?:학생\s*)?(?:모집|신청|접수)\s*기간\s*[:：]\s*(.+)$/,
      );
      if (application?.[1]) {
        const period = extractPeriod(application[1]);
        if (period) result = { ...result, applicationPeriod: period };
      }
      const operation = line.match(
        /^(?:교육\s*기간|행사\s*일자|운영\s*기간|인턴십\s*기간)\s*[:：]\s*(.+)$/,
      );
      if (operation?.[1]) {
        const period = extractPeriod(operation[1]);
        if (period?.startsAt && period.endsAt)
          result = {
            ...result,
            operationPeriod: {
              startsAt: period.startsAt,
              endsAt: period.endsAt,
            },
          };
      }
      const team = line.match(
        /^(?:팀\s*구성|팀당\s*인원|팀별\s*인원|인원|모집\s*인원)\s*[:：]\s*(.+)$/,
      );
      if (team?.[1]) {
        const range = team[1].match(
          /^(?:(\d+)\s*팀\s*\(\s*)?(\d+)\s*(?:[~～–-]\s*(\d+))?\s*명\s*\)?$/,
        );
        if (range) {
          const min = Number(range[2]);
          const max = Number(range[3] ?? range[2]);
          if (min >= 1 && max >= min && max <= 100)
            result = { ...result, teamSize: { min, max } };
        }
      }
    }
    const unique = [...new Set(organizers)];
    return {
      ...result,
      ...(unique.length > 0 && unique.length <= PROGRAM_ORGANIZERS_MAX_COUNT
        ? { organizers: unique }
        : {}),
    };
  }
}
function extractPeriod(
  input: string,
): ProgramNoticeCandidates['applicationPeriod'] {
  const parts = input.split(/\s*[~～–]\s*/);
  if (parts.length > 2) return undefined;
  const first = parts[0] ?? '';
  const year = Number(input.match(/(?:^|\D)(20\d{2})\s*[년./-]/)?.[1]);
  if (!year) return undefined;
  const start = dateParts(first, year);
  const second = parts[1];
  if (second !== undefined) {
    const time = second.match(/^\s*(\d{1,2}):(\d{2})\s*$/);
    const end =
      time && start && Number(time[1]) <= 23 && Number(time[2]) <= 59
        ? { ...start, hour: Number(time[1]), minute: Number(time[2]) }
        : dateParts(second, start?.year ?? year);
    if (!end) return undefined;
    if (!start)
      return first.trim() === '' ? { endsAt: timestamp(end, true) } : undefined;
    const startsAt = timestamp(start, false);
    const endsAt = timestamp(end, true);
    return startsAt <= endsAt ? { startsAt, endsAt } : undefined;
  }
  if (!start) return undefined;
  if (/까지/.test(input)) return { endsAt: timestamp(start, true) };
  return { startsAt: timestamp(start, false), endsAt: timestamp(start, true) };
}

type NoticeDate = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour?: number;
  readonly minute?: number;
};

function dateParts(input: string, year: number): NoticeDate | undefined {
  const match = input.match(
    /^\s*(?:(20\d{2})\s*[년./-]\s*)?(\d{1,2})\s*[월./-]\s*(\d{1,2})\s*(?:일|\.)?\s*(?:\([월화수목금토일]\))?\s*(?:(\d{1,2}):(\d{2}))?/,
  );
  if (!match) return undefined;
  const value = {
    year: Number(match[1] ?? year),
    month: Number(match[2]),
    day: Number(match[3]),
    ...(match[4] === undefined
      ? {}
      : { hour: Number(match[4]), minute: Number(match[5]) }),
  };
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day));
  if (
    date.getUTCFullYear() !== value.year ||
    date.getUTCMonth() + 1 !== value.month ||
    date.getUTCDate() !== value.day ||
    (value.hour ?? 0) > 23 ||
    (value.minute ?? 0) > 59
  )
    return undefined;
  return value;
}

function timestamp(value: NoticeDate, end: boolean): string {
  const pad = (part: number) => String(part).padStart(2, '0');
  return new Date(
    `${value.year}-${pad(value.month)}-${pad(value.day)}T${pad(value.hour ?? (end ? 23 : 0))}:${pad(value.minute ?? (end ? 59 : 0))}:00+09:00`,
  ).toISOString();
}
