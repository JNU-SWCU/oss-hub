// @vitest-environment happy-dom

import { act, useState } from 'react';
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
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      '시작일을 선택했습니다. 마감일을 선택해 주세요.',
    );
  });

  it('시각 입력은 기본으로 숨기고 시간 변경에서 연다', async () => {
    await act(async () => {
      root.render(
        <ProgramScheduleRangeEditor
          ranges={rangeFixtures()}
          activeId="milestone-1"
          onActiveIdChange={vi.fn()}
        />,
      );
    });

    const disclosure = container.querySelector<HTMLButtonElement>(
      'button[aria-controls="milestone-1-time-controls"]',
    );
    expect(disclosure?.textContent).toBe('시간 변경');
    expect(disclosure?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('input[type="time"]')).toBeNull();

    await act(async () => {
      disclosure?.click();
    });

    expect(disclosure?.getAttribute('aria-expanded')).toBe('true');
    expect(
      container.querySelector('#milestone-1-time-controls'),
    ).not.toBeNull();
    expect(container.querySelectorAll('input[type="time"]')).toHaveLength(2);
  });

  it('다른 일정 범위로 바꾸면 열린 시간 변경을 닫는다', async () => {
    await act(async () => {
      root.render(<TimeDisclosureHarness />);
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-controls="milestone-1-time-controls"]',
        )
        ?.click();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-pressed="false"]')
        ?.click();
    });

    expect(
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-controls="application-time-controls"]',
        )
        ?.getAttribute('aria-expanded'),
    ).toBe('false');
    expect(container.querySelector('input[type="time"]')).toBeNull();
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
    expect(calendar?.getAttribute('aria-label')).toBe(
      '마일스톤 1 날짜 선택 달력',
    );
    expect(calendar?.getAttribute('aria-labelledby')).toBeNull();
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

  it('좁은 화면에서는 44px 날짜 표를 줄이지 않고 가로 스크롤로 모두 노출한다', async () => {
    await act(async () => {
      root.render(
        <ProgramScheduleRangeEditor
          ranges={rangeFixtures()}
          activeId="milestone-1"
          onActiveIdChange={vi.fn()}
        />,
      );
    });

    const scroller = container.querySelector(
      '[data-testid="program-schedule-calendar-scroll"]',
    );
    const hintId = scroller?.getAttribute('aria-describedby');
    expect(scroller?.classList.contains('overflow-x-auto')).toBe(true);
    expect(scroller?.firstElementChild?.className).toContain('min-w-[22rem]');
    expect(hintId).not.toBeNull();
    expect(
      container.querySelector(`#${CSS.escape(hintId ?? '')}`)?.textContent,
    ).toContain('좌우로 밀어');
  });

  it('사용 가능한 시각 입력 오류는 시간 변경을 열고 설명 관계로 연결한다', async () => {
    const ranges = rangeFixtures().map((range) =>
      range.id === 'milestone-1'
        ? {
            ...range,
            startError: '시작 시각을 확인해 주세요.',
            endError: '마감 시각을 확인해 주세요.',
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

    for (const inputId of ['milestone-1-start', 'milestone-1-due']) {
      const input = container.querySelector<HTMLInputElement>(`#${inputId}`);
      const errorId = input?.getAttribute('aria-describedby');
      expect(input?.getAttribute('aria-invalid')).toBe('true');
      expect(errorId).not.toBeNull();
      expect(
        container.querySelector(`#${CSS.escape(errorId ?? '')}`)?.textContent,
      ).toContain('확인해 주세요');
    }
  });

  it('날짜가 없는 오류에서는 시간 변경을 열지 않는다', async () => {
    const ranges = rangeFixtures().map((range) =>
      range.id === 'milestone-1'
        ? {
            ...range,
            startAt: '',
            endAt: '',
            startError: '시작일을 선택해 주세요.',
            endError: '마감일을 선택해 주세요.',
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

    expect(
      container
        .querySelector<HTMLButtonElement>('button[aria-controls]')
        ?.getAttribute('aria-expanded'),
    ).toBe('false');
    expect(container.querySelector('input[type="time"]')).toBeNull();
    expect(
      container
        .querySelector('[data-calendar-date="2026-09-08"]')
        ?.getAttribute('tabindex'),
    ).toBe('0');
    expect(container.textContent).toContain('시작일을 선택해 주세요.');
    const calendarDescription = container
      .querySelector('[data-testid="program-schedule-calendar-scroll"]')
      ?.getAttribute('aria-describedby');
    expect(calendarDescription).toContain('scroll-hint');
    expect(
      (calendarDescription ?? '')
        .split(' ')
        .some((id) =>
          container
            .querySelector(`#${CSS.escape(id)}`)
            ?.textContent?.includes('시작일을 선택해 주세요.'),
        ),
    ).toBe(true);
  });

  it('범위보다 여러 달 앞뒤인 저장 날짜는 가장 가까운 허용 월에 달력을 연다', async () => {
    const onStartAtChange = vi.fn();
    const onEndAtChange = vi.fn();
    const beforeRange = rangeFixtures().map((range) =>
      range.id === 'milestone-1'
        ? {
            ...range,
            startAt: '2026-06-01T00:00',
            endAt: '2026-06-30T23:59',
            onStartAtChange,
            onEndAtChange,
          }
        : range,
    );

    await act(async () => {
      root.render(
        <ProgramScheduleRangeEditor
          key="before"
          ranges={beforeRange}
          activeId="milestone-1"
          onActiveIdChange={vi.fn()}
        />,
      );
    });

    expect(container.querySelector('[role="region"] strong')?.textContent).toBe(
      '2026년 9월',
    );
    expect(
      container
        .querySelector('[data-calendar-date="2026-09-08"]')
        ?.getAttribute('tabindex'),
    ).toBe('0');
    expect(onStartAtChange).not.toHaveBeenCalled();
    expect(onEndAtChange).not.toHaveBeenCalled();

    const afterRange = rangeFixtures().map((range) =>
      range.id === 'milestone-1'
        ? {
            ...range,
            startAt: '2027-01-01T00:00',
            endAt: '2027-01-31T23:59',
            onStartAtChange,
            onEndAtChange,
          }
        : range,
    );
    await act(async () => {
      root.render(
        <ProgramScheduleRangeEditor
          key="after"
          ranges={afterRange}
          activeId="milestone-1"
          onActiveIdChange={vi.fn()}
        />,
      );
    });

    expect(container.querySelector('[role="region"] strong')?.textContent).toBe(
      '2026년 10월',
    );
    expect(
      container
        .querySelector('[data-calendar-date="2026-10-31"]')
        ?.getAttribute('tabindex'),
    ).toBe('0');
    expect(onStartAtChange).not.toHaveBeenCalled();
    expect(onEndAtChange).not.toHaveBeenCalled();
  });

  it('검증이 선택한 범위를 첫 수정에서 유지해 두 번째 날짜 선택까지 적용한다', async () => {
    await act(async () => {
      root.render(<ValidationSelectionHarness />);
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-calendar-date="2026-09-15"]')
        ?.click();
    });
    expect(container.querySelector('[data-selection]')?.textContent).toBe(
      'operation|2026-09-15T00:00|2026-09-15T23:59',
    );

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-calendar-date="2026-09-17"]')
        ?.click();
    });
    expect(container.querySelector('[data-selection]')?.textContent).toBe(
      'operation|2026-09-15T00:00|2026-09-17T23:59',
    );
  });

  it('단순 일정 레이아웃은 겹치는 신청·운영 날짜를 달력에서 선택할 수 있다', async () => {
    const onStartAtChange = vi.fn();
    const onEndAtChange = vi.fn();
    const ranges = rangeFixtures()
      .filter((range) => range.kind !== 'MILESTONE')
      .map((range) =>
        range.id === 'application'
          ? {
              ...range,
              startAt: '2026-09-08T00:00',
              endAt: '2026-09-15T23:59',
              onStartAtChange,
              onEndAtChange,
            }
          : {
              ...range,
              startAt: '2026-09-08T00:00',
              endAt: '2026-09-20T23:59',
            },
      );

    await act(async () => {
      root.render(
        <ProgramScheduleRangeEditor
          ranges={ranges}
          activeId="application"
          layout="simple"
          onActiveIdChange={vi.fn()}
        />,
      );
    });

    const overlappingDate = container.querySelector<HTMLButtonElement>(
      '[data-calendar-date="2026-09-15"]',
    );
    expect(overlappingDate?.disabled).toBe(false);
    expect(
      container.querySelectorAll('[data-schedule-range-selector]'),
    ).toHaveLength(2);
    const selectorGroup = container.querySelector('[aria-label="일정 선택"]');
    expect(selectorGroup?.className).not.toContain('sm:grid-cols-2');
    expect(container.textContent).not.toContain('선택 중');
    const manualButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="신청 기간 일정 입력"]',
    );
    expect(manualButton?.closest('[data-schedule-range-row]')).toBe(
      container
        .querySelector('[data-schedule-range-selector]')
        ?.closest('[data-schedule-range-row]'),
    );
    await act(async () => {
      manualButton?.click();
    });
    expect(
      document.body.querySelector('[role="dialog"]')?.textContent,
    ).toContain('신청 기간');
    expect(document.body.textContent).not.toContain('직접 입력');
    expect(
      document.body.querySelector<HTMLInputElement>(
        'input[aria-label="신청 기간 시작일"]',
      )?.value,
    ).toBe('2026-09-08');
    const cancel = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '취소',
    );
    await act(async () => {
      cancel?.click();
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => {
      overlappingDate?.click();
    });
    expect(onStartAtChange).toHaveBeenCalledWith('2026-09-15T00:00');
    expect(
      container.querySelector('button[aria-label="신청 기간 시간 변경"]'),
    ).toBeNull();
    const resetButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="신청 기간 초기화"]',
    );
    await act(async () => {
      resetButton?.click();
    });
    expect(onStartAtChange).toHaveBeenLastCalledWith('');
    expect(onEndAtChange).toHaveBeenCalledWith('');
  });

  it('단순 일정 레이아웃은 파싱된 날짜의 범위 오류를 검증 대상 행과 달력에 연결한다', async () => {
    const onActiveIdChange = vi.fn();
    const ranges = rangeFixtures().map((range) =>
      range.id === 'operation'
        ? {
            ...range,
            startError: '운영 시작은 신청 종료 이후여야 합니다.',
            endError: '운영 종료는 운영 시작보다 늦어야 합니다.',
          }
        : range,
    );

    await act(async () => {
      root.render(
        <ProgramScheduleRangeEditor
          ranges={ranges}
          activeId="application"
          validationActiveId="operation"
          layout="simple"
          onActiveIdChange={onActiveIdChange}
        />,
      );
    });

    const selector = container.querySelector<HTMLButtonElement>(
      '[data-schedule-range-selector][aria-pressed="true"]',
    );
    const errorId = selector?.getAttribute('aria-describedby');
    expect(onActiveIdChange).toHaveBeenCalledWith('operation');
    expect(selector?.textContent).toContain('운영 기간');
    expect(selector?.getAttribute('aria-invalid')).toBe('true');
    expect(errorId).toBe('operation-schedule-error');
    expect(
      container.querySelector(`#${CSS.escape(errorId ?? '')}`)?.textContent,
    ).toContain('운영 시작은 신청 종료 이후여야 합니다.');
    const calendar = container.querySelector(
      '[data-testid="program-schedule-calendar-scroll"]',
    );
    expect(calendar?.getAttribute('aria-invalid')).toBe('true');
    expect(calendar?.getAttribute('aria-describedby')).toContain(errorId);
    expect(container.querySelector('input[type="time"]')).toBeNull();
  });

  it('통합 일정 모달은 역전된 시각 오류를 모든 입력에 연결한 뒤 수정값을 저장한다', async () => {
    const onStartAtChange = vi.fn();
    const onEndAtChange = vi.fn();
    const ranges = rangeFixtures().map((range) =>
      range.id === 'application'
        ? { ...range, onStartAtChange, onEndAtChange }
        : range,
    );
    await act(async () => {
      root.render(
        <ProgramScheduleRangeEditor
          ranges={ranges}
          activeId="application"
          layout="simple"
          onActiveIdChange={vi.fn()}
        />,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="신청 기간 일정 입력"]',
        )
        ?.click();
    });
    const setInput = async (label: string, value: string) => {
      const input = document.body.querySelector<HTMLInputElement>(
        `input[aria-label="${label}"]`,
      );
      if (input === null) throw new TypeError(`Missing ${label}.`);
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };
    await setInput('신청 기간 시작일', '2026-09-08');
    await setInput('신청 기간 시작 시각', '18:00');
    await setInput('신청 기간 종료일', '2026-09-08');
    await setInput('신청 기간 종료 시각', '17:00');
    const save = () =>
      [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === '저장',
      );
    await act(async () => save()?.click());

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const inputs = dialog?.querySelectorAll('input') ?? [];
    expect(
      [...inputs].every(
        (input) => input.getAttribute('aria-invalid') === 'true',
      ),
    ).toBe(true);
    const errorId = inputs[0]?.getAttribute('aria-describedby');
    expect(errorId).toBeTruthy();
    expect(document.getElementById(errorId ?? '')?.textContent).toContain(
      '종료는 시작보다 늦어야 합니다.',
    );

    await setInput('신청 기간 종료 시각', '19:00');
    await act(async () => save()?.click());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(onStartAtChange).toHaveBeenCalledWith('2026-09-08T18:00');
    expect(onEndAtChange).toHaveBeenCalledWith('2026-09-08T19:00');
  });
});

function ValidationSelectionHarness() {
  const [activeId, setActiveId] = useState('application');
  const [validationActiveId, setValidationActiveId] = useState<string | null>(
    'operation',
  );
  const [startAt, setStartAt] = useState('2026-09-08T00:00');
  const [endAt, setEndAt] = useState('2026-10-31T23:59');
  const ranges = rangeFixtures().map((range) =>
    range.id === 'operation'
      ? {
          ...range,
          startAt,
          endAt,
          onStartAtChange: (value: string) => {
            setValidationActiveId(null);
            setStartAt(value);
          },
          onEndAtChange: (value: string) => {
            setValidationActiveId(null);
            setEndAt(value);
          },
        }
      : range,
  );

  return (
    <>
      <ProgramScheduleRangeEditor
        ranges={ranges}
        activeId={activeId}
        validationActiveId={validationActiveId}
        onActiveIdChange={setActiveId}
      />
      <output data-selection>{`${activeId}|${startAt}|${endAt}`}</output>
    </>
  );
}

function TimeDisclosureHarness() {
  const [activeId, setActiveId] = useState('milestone-1');
  return (
    <ProgramScheduleRangeEditor
      ranges={rangeFixtures()}
      activeId={activeId}
      onActiveIdChange={setActiveId}
    />
  );
}

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
