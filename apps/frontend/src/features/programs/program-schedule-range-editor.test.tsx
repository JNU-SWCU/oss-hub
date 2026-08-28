// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgramScheduleRangeEditor } from './program-schedule-range-editor';
import type { ProgramScheduleEditableRange } from './program-schedule-range-types';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('ProgramScheduleRangeEditor', () => {
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

  it('마일스톤 선택에서는 운영 기간 밖 날짜를 비활성화한다', async () => {
    const ranges = rangeFixtures();

    await act(async () => {
      root.render(
        <ProgramScheduleRangeEditor
          ranges={ranges}
          activeId="milestone-1"
          onActiveIdChange={vi.fn()}
        />,
      );
    });

    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-calendar-date="2026-09-07"]',
      )?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-calendar-date="2026-09-08"]',
      )?.disabled,
    ).toBe(false);
  });

  it('첫 날짜 선택은 시작·마감 기본 시각을 한 번에 알리고 저장한다', async () => {
    const onStartAtChange = vi.fn();
    const onEndAtChange = vi.fn();
    const ranges = rangeFixtures().map((range) =>
      range.id === 'milestone-1'
        ? { ...range, startAt: '', endAt: '', onStartAtChange, onEndAtChange }
        : range,
    );

    await act(async () => {
      root.render(
        <ProgramScheduleRangeEditor
          ranges={ranges}
          activeId="milestone-1"
          onActiveIdChange={vi.fn()}
        />,
      );
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-calendar-date="2026-09-15"]')
        ?.click();
    });

    expect(onStartAtChange).toHaveBeenCalledWith('2026-09-15T00:00');
    expect(onEndAtChange).toHaveBeenCalledWith('2026-09-15T23:59');
    expect(
      container.querySelector('[aria-live="polite"]')?.textContent,
    ).toContain('마감 날짜를 선택해 주세요');
  });

  it('시각 입력을 항상 보이고 세부 일정 열기 버튼은 만들지 않는다', async () => {
    await act(async () => {
      root.render(
        <ProgramScheduleRangeEditor
          ranges={rangeFixtures()}
          activeId="milestone-1"
          onActiveIdChange={vi.fn()}
        />,
      );
    });

    expect(container.querySelector('input[type="time"]')).not.toBeNull();
    expect(container.textContent).toContain(
      '선택한 기간의 시작 시각과 마감 시각을 입력해 주세요',
    );
    expect(container.textContent).not.toContain('세부 일정 설정');
    expect(container.textContent).not.toContain('세부 일정 닫기');
  });

  it('보조기술에도 모든 일정 범위를 한꺼번에 설명한다', async () => {
    await act(async () => {
      root.render(
        <ProgramScheduleRangeEditor
          ranges={rangeFixtures()}
          activeId="milestone-1"
          onActiveIdChange={vi.fn()}
        />,
      );
    });

    const calendar = container.querySelector('[role="region"]');
    expect(calendar?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(calendar?.textContent).toContain(
      '신청 기간: 2026년 9월 1일 (화요일)부터 2026년 9월 7일 (월요일)까지',
    );
    expect(calendar?.textContent).toContain(
      '마일스톤 1: 2026년 9월 15일 (화요일)부터 2026년 9월 22일 (화요일)까지',
    );
  });

  it('모바일에서 달력 제목은 짧게 유지하고 하루짜리 막대에는 잘린 이름을 노출하지 않는다', async () => {
    const ranges = rangeFixtures().map((range) =>
      range.id === 'milestone-1'
        ? {
            ...range,
            startAt: '2026-09-15T00:00',
            endAt: '2026-09-15T23:59',
          }
        : range,
    );

    await act(async () => {
      root.render(
        <ProgramScheduleRangeEditor
          ranges={ranges}
          activeId="milestone-1"
          onActiveIdChange={vi.fn()}
        />,
      );
    });

    const calendar = container.querySelector(
      '[aria-label="마일스톤 1 날짜 선택 달력"]',
    );
    expect(calendar?.querySelector('strong')?.textContent).toBe('2026년 9월');
    expect(
      container
        .querySelector<HTMLButtonElement>('[aria-pressed="true"]')
        ?.classList.contains('break-keep'),
    ).toBe(true);
    expect(
      [...(calendar?.querySelectorAll('[aria-hidden="true"]') ?? [])].some(
        (node) => node.textContent?.includes('마일스톤 1'),
      ),
    ).toBe(false);
  });
});

function rangeFixtures(): readonly ProgramScheduleEditableRange[] {
  const noOp = () => undefined;
  return [
    {
      id: 'application',
      label: '신청 기간',
      kind: 'APPLICATION',
      startAt: '2026-09-01T00:00',
      endAt: '2026-09-07T23:59',
      startInputId: 'application-start',
      endInputId: 'application-end',
      onStartAtChange: noOp,
      onEndAtChange: noOp,
    },
    {
      id: 'operation',
      label: '운영 기간',
      kind: 'OPERATION',
      startAt: '2026-09-08T00:00',
      endAt: '2026-10-31T23:59',
      startInputId: 'operation-start',
      endInputId: 'operation-end',
      onStartAtChange: noOp,
      onEndAtChange: noOp,
    },
    {
      id: 'milestone-1',
      label: '마일스톤 1',
      kind: 'MILESTONE',
      startAt: '2026-09-15T00:00',
      endAt: '2026-09-22T23:59',
      minDate: '2026-09-08',
      maxDate: '2026-10-31',
      startInputId: 'milestone-1-start',
      endInputId: 'milestone-1-due',
      onStartAtChange: noOp,
      onEndAtChange: noOp,
    },
  ];
}
