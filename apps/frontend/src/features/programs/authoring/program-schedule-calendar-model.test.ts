import { describe, expect, it } from 'vitest';
import {
  calendarWeeks,
  eventsForDate,
  selectedDateForMonth,
  shiftDate,
  segmentsForWeek,
  type ProgramScheduleCalendarEvent,
} from './program-schedule-calendar-model';

const application: ProgramScheduleCalendarEvent = {
  id: 'application',
  label: '신청 기간',
  kind: 'APPLICATION',
  startAt: '2026-09-01T09:00',
  endAt: '2026-09-07T18:00',
};

describe('program schedule calendar model', () => {
  it('주 경계를 넘는 기간을 양쪽 연결 조각으로 만든다', () => {
    const weeks = calendarWeeks('2026-09');
    const firstWeek = weeks[0];
    const secondWeek = weeks[1];
    if (firstWeek === undefined || secondWeek === undefined) {
      throw new TypeError('달력 주차가 생성되지 않았습니다.');
    }
    const first = segmentsForWeek(firstWeek, [application])[0];
    const second = segmentsForWeek(secondWeek, [application])[0];

    expect(first).toMatchObject({
      startColumn: 3,
      span: 5,
      continuesBefore: false,
      continuesAfter: true,
    });
    expect(second).toMatchObject({
      startColumn: 1,
      span: 2,
      continuesBefore: true,
      continuesAfter: false,
    });
  });

  it('기간 중간 날짜를 선택해도 진행 중 일정으로 찾는다', () => {
    expect(eventsForDate('2026-09-04', [application])).toEqual([application]);
  });

  it('달을 이동하면 그 달의 첫 일정 날짜를 선택하고 일정이 없으면 1일을 선택한다', () => {
    expect(selectedDateForMonth('2026-09', [application])).toBe('2026-09-01');
    expect(selectedDateForMonth('2026-10', [application])).toBe('2026-10-01');
  });

  it('이전 달부터 이어지는 일정은 이동한 달의 1일부터 보여준다', () => {
    expect(
      selectedDateForMonth('2026-09', [
        { ...application, startAt: '2026-08-29T09:00' },
      ]),
    ).toBe('2026-09-01');
  });

  it('방향키용 날짜 이동은 월과 연도 경계를 넘는다', () => {
    expect(shiftDate('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
  });
});
