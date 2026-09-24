// @vitest-environment happy-dom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  toMilestoneForm,
  type ProgramMilestoneErrors,
  type ProgramMilestoneForm,
} from './program-edit-flow';
import { ProgramEditMilestoneForm } from './program-edit-milestone-form';

const savedForm = toMilestoneForm({
  id: 'milestone-1',
  name: '기획서 제출',
  startAt: '2026-08-16T09:30:59.000Z',
  dueAt: '2026-08-20T09:30:59.000Z',
  submissionType: 'TEXT',
  instructions: '초안을 제출하세요.',
});

function renderForm(
  errors: ProgramMilestoneErrors,
  {
    layout = 'card',
    form = savedForm,
  }: {
    readonly layout?: 'card' | 'dialog';
    readonly form?: ProgramMilestoneForm;
  } = {},
): HTMLDivElement {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    <ProgramEditMilestoneForm
      editor={{ mode: 'edit', form, initialForm: form, errors }}
      operationStartAt="2026-08-01T09:00"
      operationEndAt="2026-08-31T18:00"
      contextEvents={[]}
      isBusy={false}
      layout={layout}
      onCancel={() => undefined}
      onFieldChange={() => undefined}
      onSave={() => undefined}
    />,
  );
  return container;
}

function summaryOf(container: HTMLElement): Element | null {
  return container.querySelector('[data-slot="form-error-summary"]');
}

describe('마일스톤 폼 상단 오류 요약(R-16)', () => {
  it.each(['card', 'dialog'] as const)(
    '%s — 이름·일정·공지가 틀리면 보이는 오류 줄 수만큼 맨 위에 알린다',
    (layout) => {
      const container = renderForm(
        {
          name: '마일스톤 이름을 입력해 주세요.',
          startAt: '유효한 시작일을 입력해 주세요.',
          dueAt: '유효한 마감일을 입력해 주세요.',
          instructions: '공지는 2000자 이하여야 합니다.',
        },
        { layout },
      );

      // 일정은 시작·마감 오류를 한 줄로 합쳐 보이므로 보이는 줄은 셋이다.
      const visibleFieldErrors = container.querySelectorAll(
        '[data-slot="field-error"]',
      );
      expect(visibleFieldErrors).toHaveLength(3);
      expect(summaryOf(container)?.textContent).toBe('고칠 칸이 3개 있습니다');
    },
  );

  it('요약은 폼의 첫 칸(일정 달력)보다 앞에 선다', () => {
    const container = renderForm({
      name: '마일스톤 이름을 입력해 주세요.',
      dueAt: '유효한 마감일을 입력해 주세요.',
    });
    const summary = summaryOf(container);
    const firstField = container.querySelector(
      '[data-testid="program-schedule-calendar-scroll"]',
    );
    if (summary === null || firstField === null) {
      throw new TypeError('요약이나 첫 칸이 없다.');
    }
    expect(container.querySelector('form')?.contains(summary)).toBe(true);
    expect(
      summary.compareDocumentPosition(firstField) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('보이는 오류가 한 줄이면 요약이 없다 — 시작·마감이 함께 틀려도 일정은 한 줄이다', () => {
    expect(
      summaryOf(renderForm({ name: '마일스톤 이름을 입력해 주세요.' })),
    ).toBeNull();
    expect(
      summaryOf(
        renderForm({
          startAt: '유효한 시작일을 입력해 주세요.',
          dueAt: '유효한 마감일을 입력해 주세요.',
        }),
      ),
    ).toBeNull();
  });

  it('저장 버튼 옆 일반 오류와 값이 없는 키는 세지 않는다(수정 창 서버 실패 모양)', () => {
    // program-edit-page 의 수정 실패 경로는 general 을 두고 필드 키를 undefined 로도 채운다.
    expect(
      summaryOf(
        renderForm(
          {
            general: '다른 변경과 충돌했습니다.',
            name: '이름이 이미 있습니다.',
            startAt: undefined,
            dueAt: undefined,
            instructions: undefined,
          },
          { layout: 'dialog' },
        ),
      ),
    ).toBeNull();
    expect(
      summaryOf(
        renderForm(
          {
            general: '다른 변경과 충돌했습니다.',
            name: '이름이 이미 있습니다.',
            startAt: undefined,
            dueAt: '마감을 확인해 주세요.',
            instructions: undefined,
          },
          { layout: 'dialog' },
        ),
      )?.textContent,
    ).toBe('고칠 칸이 2개 있습니다');
  });

  it('저장을 누르기 전에는 이름·일정이 비어 있어도 요약이 없다', () => {
    const emptyForm: ProgramMilestoneForm = {
      ...savedForm,
      id: null,
      name: '',
      startAt: '',
      dueAt: '',
      originalStartAt: null,
      originalDueAt: null,
    };
    const container = renderForm({}, { form: emptyForm });
    expect(summaryOf(container)).toBeNull();
    expect(container.querySelector('[data-slot="field-error"]')).toBeNull();
  });
});
