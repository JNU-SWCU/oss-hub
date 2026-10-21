import { describe, expect, it } from 'vitest';
import {
  dateTimeForDate,
  dateWithinBounds,
  planRangeDateSelection,
} from './program-schedule-range-selection';

describe('프로그램 일정 범위 선택', () => {
  it('첫 날짜는 시작과 마감을 같은 날의 명시된 기본 시각으로 만든다', () => {
    const plan = planRangeDateSelection({
      anchorDate: null,
      clickedDate: '2026-09-15',
      currentStartAt: '',
      currentEndAt: '',
    });

    expect(plan).toEqual({
      anchorDate: '2026-09-15',
      startAt: '2026-09-15T00:00',
      endAt: '2026-09-15T23:59',
    });
  });

  it('두 번째 날짜가 앞이면 날짜만 정렬하고 시작·마감 시각은 유지한다', () => {
    const plan = planRangeDateSelection({
      anchorDate: '2026-09-22',
      clickedDate: '2026-09-15',
      currentStartAt: '2026-09-22T09:30',
      currentEndAt: '2026-09-22T18:45',
    });

    expect(plan).toEqual({
      anchorDate: null,
      startAt: '2026-09-15T09:30',
      endAt: '2026-09-22T18:45',
    });
  });

  it('날짜를 바꿀 때 기존 시각을 보존한다', () => {
    expect(dateTimeForDate('2026-10-03', '2026-09-01T13:20', '00:00')).toBe(
      '2026-10-03T13:20',
    );
  });

  it('운영 기간 양 끝만 마일스톤 선택 가능 범위로 인정한다', () => {
    expect(dateWithinBounds('2026-09-08', '2026-09-08', '2026-10-31')).toBe(
      true,
    );
    expect(dateWithinBounds('2026-10-31', '2026-09-08', '2026-10-31')).toBe(
      true,
    );
    expect(dateWithinBounds('2026-09-07', '2026-09-08', '2026-10-31')).toBe(
      false,
    );
  });
});
