// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgramScheduleRangeCalendar } from './program-schedule-range-calendar';
import type { ProgramScheduleCalendarEvent } from './program-schedule-calendar-model';
import type { ProgramScheduleEditableRange } from './program-schedule-range-types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('ProgramScheduleRangeCalendar', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('같은 마일스톤 ID에는 안정적인 색을 쓰고 서로 다른 ID는 구분한다', async () => {
    await renderCalendar([
      event('milestone-1', '마일스톤 하나', 'MILESTONE'),
      event('milestone-1', '마일스톤 하나 반복', 'MILESTONE'),
      event('milestone-2', '마일스톤 둘', 'MILESTONE'),
    ]);

    const first = rangeBar('마일스톤 하나');
    const repeated = rangeBar('마일스톤 하나 반복');
    const second = rangeBar('마일스톤 둘');

    expect(first?.className).toBe(repeated?.className);
    expect(first?.className).not.toBe(second?.className);
  });

  it('신청과 운영 기간의 고정 색은 마일스톤 ID와 무관하다', async () => {
    await renderCalendar([
      event('application-any-id', '신청 기간', 'APPLICATION'),
      event('operation-any-id', '운영 기간', 'OPERATION'),
    ]);

    expect(rangeBar('신청 기간')?.classList.contains('bg-blue-600')).toBe(true);
    expect(rangeBar('운영 기간')?.classList.contains('bg-emerald-700')).toBe(
      true,
    );
  });

  it('최종 검토 달력은 날짜를 수정 버튼으로 노출하지 않는다', async () => {
    await renderCalendar(
      [
        event('application', '신청 기간', 'APPLICATION'),
        event('operation', '운영 기간', 'OPERATION'),
      ],
      true,
    );

    expect(
      container.querySelector('[aria-label="전체 일정 달력"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-calendar-date]')).toBeNull();
    expect(
      container.querySelector('span[aria-label*="2026년 9월"]'),
    ).not.toBeNull();
    expect(container.querySelector('[role="gridcell"]')).toBeNull();
    const scroller = container.querySelector(
      '[data-testid="program-schedule-calendar-scroll"]',
    );
    expect(scroller?.getAttribute('aria-label')).toBe('일정 달력 가로 스크롤');
    expect(scroller?.hasAttribute('aria-invalid')).toBe(false);
  });

  it('모바일 안내 문구는 한국어 어절 안에서 줄바꿈하지 않는다', async () => {
    // Given / When
    await renderCalendar([]);

    // Then
    const selectionHint = [...container.querySelectorAll('p')].find((element) =>
      element.textContent?.includes('선택할 수 없음'),
    );
    const scrollHint = [...container.querySelectorAll('p')].find((element) =>
      element.textContent?.includes('수 있습니다'),
    );
    expect(selectionHint?.classList.contains('break-keep')).toBe(true);
    expect(scrollHint?.classList.contains('break-keep')).toBe(true);
    expect(
      [...container.querySelectorAll('span')]
        .find((element) => element.textContent === '선택할 수 없음')
        ?.classList.contains('whitespace-nowrap'),
    ).toBe(true);
    expect(
      [...container.querySelectorAll('span')]
        .find((element) => element.textContent === '볼 수 있습니다.')
        ?.classList.contains('whitespace-nowrap'),
    ).toBe(true);
  });

  function rangeBar(label: string): HTMLDivElement | null {
    return ([...container.querySelectorAll('span')].find(
      (element) => element.textContent === label,
    )?.parentElement ?? null) as HTMLDivElement | null;
  }

  async function renderCalendar(
    events: readonly ProgramScheduleCalendarEvent[],
    readOnly = false,
  ) {
    await act(async () => {
      root.render(
        <ProgramScheduleRangeCalendar
          events={events}
          activeRange={
            readOnly
              ? { ...activeRange(), label: '전체', kind: 'OPERATION' }
              : activeRange()
          }
          readOnly={readOnly}
          selectionInvalid={readOnly}
          monthKey="2026-09"
          focusedDate="2026-09-01"
          onMonthKeyChange={vi.fn()}
          onFocusedDateChange={vi.fn()}
          onDateSelect={vi.fn()}
        />,
      );
    });
  }
});

function event(
  id: string,
  label: string,
  kind: ProgramScheduleCalendarEvent['kind'],
): ProgramScheduleCalendarEvent {
  return {
    id,
    label,
    kind,
    startAt: '2026-09-08T00:00',
    endAt: '2026-09-10T23:59',
  };
}

function activeRange(): ProgramScheduleEditableRange {
  return {
    id: 'milestone-editor',
    label: '마일스톤',
    kind: 'MILESTONE',
    startAt: '',
    endAt: '',
    minDate: '2026-09-01',
    maxDate: '2026-09-30',
    startInputId: 'start-at',
    endInputId: 'end-at',
    onStartAtChange: vi.fn(),
    onEndAtChange: vi.fn(),
  };
}
