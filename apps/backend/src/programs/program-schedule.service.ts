import { Injectable } from '@nestjs/common';

@Injectable()
export class ProgramScheduleService {
  programDeadline(
    dueAt: Date,
    now: Date,
  ): {
    readonly dDay: number;
    readonly label: string;
  } {
    const dDay = calendarDayNumber(dueAt) - calendarDayNumber(now);
    const label =
      dDay < 0 ? '마감 지남' : dDay === 0 ? '오늘 마감' : `D-${dDay}`;
    return { dDay, label };
  }

  hasProgramDeadlinePassed(dueAt: Date, now: Date): boolean {
    return now.getTime() > dueAt.getTime();
  }

  isProgramEndAtUndecided(value: Date): boolean {
    return value.getTime() === PROGRAM_END_AT_UNDECIDED_TIME;
  }

  addOneCalendarYear(value: Date): Date {
    const result = new Date(value);
    const month = result.getUTCMonth();
    result.setUTCFullYear(result.getUTCFullYear() + 1);
    if (month === 1 && result.getUTCMonth() !== month) {
      result.setUTCDate(0);
    }
    return result;
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

const PROGRAM_END_AT_UNDECIDED_TIME = Date.UTC(9999, 11, 31, 23, 59, 59, 999);
