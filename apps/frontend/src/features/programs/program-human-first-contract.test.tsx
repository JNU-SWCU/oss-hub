// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgramAuthoringManifest } from './program-authoring-manifest';
import { ProgramAuthoringMilestoneStep } from './program-authoring-milestone-step';
import { ProgramAuthoringReviewStep } from './program-authoring-final-steps';
import { ProgramAuthoringScheduleStep } from './program-authoring-schedule-step';
import { completedAuthoringState } from './program-creation-test-fixtures';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('사람 중심 프로그램 작성 계약', () => {
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

  it('신규 write에서 마일스톤과 제출 항목의 방식 필드를 보내지 않는다', () => {
    const state = completedAuthoringState();
    const milestone = state.milestones[0];
    if (milestone === undefined) throw new TypeError('Missing milestone.');
    const manifest = buildProgramAuthoringManifest(
      {
        ...state,
        milestones: [
          {
            ...milestone,
            requirements: [
              {
                id: 'requirement-1',
                name: '결과 보고서',
                required: true,
                templateFile: null,
              },
            ],
          },
        ],
      },
      new Map(),
    );

    expect(manifest.milestones[0]).not.toHaveProperty('submissionType');
    expect(manifest.milestones[0]?.documents[0]).not.toHaveProperty(
      'submissionType',
    );
  });

  it('마일스톤 화면은 캘린더·공지·첨부만 노출한다', async () => {
    const state = completedAuthoringState();
    const milestone = {
      ...state.milestones[0]!,
      requirements: [
        {
          id: 'requirement-1',
          name: '결과보고서양식.docx',
          required: true,
          templateFile: {
            name: '결과보고서양식.docx',
            size: 1024,
            type: 'application/octet-stream',
            requiresReselection: false,
          },
        },
      ],
    };

    await act(async () => {
      root.render(
        <ProgramAuthoringMilestoneStep
          state={{ ...state, milestones: [milestone] }}
          issues={[]}
          dispatch={vi.fn()}
          newId={() => 'new-id'}
          onRequirementFileChange={vi.fn()}
          onRequirementRemove={vi.fn()}
          onMilestoneCancel={vi.fn()}
          onMilestoneEditStart={vi.fn()}
          onMilestoneSave={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain('마일스톤 목록');
    expect(container.textContent).toContain('결과보고서양식.docx · 필수');
    expect(
      container.querySelector('[data-slot="card-title"]')?.className,
    ).toContain('text-lg');
    expect(
      container.querySelector('[data-slot="card-action"]')?.className,
    ).toContain('absolute');
    expect(container.textContent).not.toContain('제출 항목');
    expect(container.textContent).not.toContain('학생에게 보여줄 안내');
    const edit = container.querySelector<HTMLButtonElement>(
      'button[aria-label="오리엔테이션 수정"]',
    );
    if (edit === null) throw new TypeError('수정 버튼이 없습니다.');
    await act(async () => edit.click());
    expect(document.body.textContent).toContain('공지사항');
    expect(document.body.textContent).toContain('첨부파일');
    expect(document.body.textContent).toContain('필수 제출');
    expect(document.body.textContent).not.toContain('제출 항목 이름');
  });

  it('첨부가 없는 공지형 마일스톤은 제출 없음으로 검토한다', async () => {
    await act(async () => {
      root.render(
        <ProgramAuthoringReviewStep state={completedAuthoringState()} />,
      );
    });

    expect(container.textContent).toContain('제출 없음');
    expect(container.textContent).not.toContain('안내용');
    expect(container.textContent).not.toContain('파일 · 필수');
    expect(
      container.querySelector('[aria-label="전체 일정 달력"]'),
    ).not.toBeNull();
  });

  it('일정 화면에서 신청과 운영 날짜를 달력 먼저 선택한다', async () => {
    const state = completedAuthoringState();

    await act(async () => {
      root.render(
        <ProgramAuthoringScheduleStep
          state={state}
          issues={[]}
          dispatch={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain('신청 · 운영 일정');
    expect(container.textContent).toContain(
      '달력에서 시작일과 종료일을 차례로 선택하세요.',
    );
    expect(container.textContent).toContain('신청 기간');
    expect(container.textContent).toContain('운영 기간');
    expect(container.textContent).not.toContain('오리엔테이션');
    expect(container.textContent).not.toContain('마일스톤 추가');
    expect(container.textContent).not.toContain('선택 중');
    expect(
      container.querySelectorAll('[data-schedule-range-selector]'),
    ).toHaveLength(2);
    const calendar = container.querySelector('[role="region"]');
    const selectors = container.querySelector('[aria-label="일정 선택"]');
    expect(
      (calendar?.compareDocumentPosition(selectors ?? container) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container.textContent).not.toContain('시각 선택');
    expect(
      container.querySelector('button[aria-label="신청 기간 시간 변경"]'),
    ).toBeNull();
    const scheduleButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="신청 기간 일정 입력"]',
    );
    if (scheduleButton === null)
      throw new TypeError('일정 입력 버튼을 찾지 못했습니다.');
    await act(async () => scheduleButton.click());
    expect(
      document.body.querySelector('[role="dialog"]')?.textContent,
    ).toContain('신청 기간');
    expect(
      document.body.querySelectorAll('[role="dialog"] input[type="time"]'),
    ).toHaveLength(2);
    expect(container.textContent).toMatch(/2026년 9월 1일 \(.요일\)/);
    const calendarGrid = container.querySelector(
      '[aria-label="신청 기간 날짜 선택 달력"]',
    );
    expect(calendarGrid).not.toBeNull();
    expect(
      container.querySelectorAll('[data-calendar-date][tabindex="0"]'),
    ).toHaveLength(1);
  });

  it('달을 넘기면 선택 상세를 새 달로 옮기고 날짜 방향키를 지원한다', async () => {
    await act(async () => {
      root.render(
        <ProgramAuthoringScheduleStep
          state={completedAuthoringState()}
          issues={[]}
          dispatch={vi.fn()}
        />,
      );
    });

    const operation = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.includes('운영 기간'));
    if (operation === undefined)
      throw new TypeError('운영 기간 버튼이 없습니다.');
    await act(async () => operation.click());
    const nextMonth = container.querySelector<HTMLButtonElement>(
      'button[aria-label="다음 달"]',
    );
    if (nextMonth === null) throw new TypeError('다음 달 버튼이 없습니다.');
    await act(async () => nextMonth.click());

    expect(container.textContent).toContain('2026년 10월');
    const selected = container.querySelector<HTMLButtonElement>(
      '[data-calendar-date="2026-10-01"][tabindex="0"]',
    );
    if (selected === null) throw new TypeError('초점을 받을 날짜가 없습니다.');
    await act(async () => {
      selected.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(
      container.querySelector('[data-calendar-date="2026-10-02"]'),
    );
  });
});
