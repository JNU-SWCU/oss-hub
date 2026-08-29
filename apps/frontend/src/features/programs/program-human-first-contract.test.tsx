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

  it('마일스톤 화면은 상위 FILE/TEXT와 신규 TEXT 항목 선택을 노출하지 않는다', async () => {
    const state = completedAuthoringState();
    const milestone = state.milestones[0];
    if (milestone === undefined) throw new TypeError('Missing milestone.');

    await act(async () => {
      root.render(
        <ProgramAuthoringMilestoneStep
          state={{
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
          }}
          issues={[]}
          dispatch={vi.fn()}
          newId={() => 'new-id'}
          onRequirementFileChange={vi.fn()}
          onRequirementRemove={vi.fn()}
        />,
      );
    });

    expect(container.textContent).not.toContain('기본 제출 방식');
    expect(container.textContent).not.toContain('텍스트 중심');
    expect(container.textContent).not.toContain('텍스트 입력');
    expect(container.textContent).toContain(
      '내용만, 파일만, 또는 둘 다 제출할 수 있습니다',
    );
    const milestoneInstructions = container.querySelector(
      'textarea[id$="-instructions"]',
    );
    const submissionHelp = [
      ...container.querySelectorAll('[data-slot="field-description"]'),
    ].find((node) => node.textContent?.includes('내용만, 파일만'));
    const templateHelp = [
      ...container.querySelectorAll('[data-slot="field-description"]'),
    ].find((node) => node.textContent?.includes('학생이 참고할 자료'));

    expect(submissionHelp?.classList).toContain('break-keep');
    expect(submissionHelp?.classList).toContain('text-pretty');
    expect(milestoneInstructions?.classList).toContain('break-keep');
    expect(milestoneInstructions?.classList).toContain('text-pretty');
    expect(templateHelp?.classList).toContain('break-keep');
    expect(templateHelp?.classList).toContain('text-pretty');
    expect(
      [...container.querySelectorAll('span.whitespace-nowrap')].some(
        (node) => node.textContent === '둘 다',
      ),
    ).toBe(true);
    expect(
      [...container.querySelectorAll('span.whitespace-nowrap')].some(
        (node) => node.textContent === '올려 주세요.',
      ),
    ).toBe(true);
  });

  it('최종 검토도 저장용 FILE 값을 학생 제출 방식으로 오해하게 표시하지 않는다', async () => {
    await act(async () => {
      root.render(
        <ProgramAuthoringReviewStep state={completedAuthoringState()} />,
      );
    });

    expect(container.textContent).toContain('내용이나 파일로 제출 가능');
    expect(container.textContent).not.toContain('파일 · 필수');
  });

  it('일정 화면에서 신청·운영·마일스톤 날짜와 한국어 선택값을 한 번에 확인한다', async () => {
    const state = completedAuthoringState();

    await act(async () => {
      root.render(
        <ProgramAuthoringScheduleStep
          state={state}
          issues={[]}
          dispatch={vi.fn()}
          newId={() => 'new-id'}
          onMilestoneRemove={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain('신청·운영·마일스톤 일정');
    expect(container.textContent).toContain('신청 기간');
    expect(container.textContent).toContain('운영 기간');
    expect(container.textContent).toContain('오리엔테이션');
    expect(container.textContent).toContain(
      '선택한 기간의 시작 시각과 마감 시각을 입력해 주세요',
    );
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
          newId={() => 'new-id'}
          onMilestoneRemove={vi.fn()}
        />,
      );
    });

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
