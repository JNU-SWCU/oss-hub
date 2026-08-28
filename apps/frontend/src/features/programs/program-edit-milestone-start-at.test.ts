// @vitest-environment happy-dom

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { updateMilestone, type EditableMilestone } from './api';
import { buildMilestoneInput, toMilestoneForm } from './program-edit-flow';
import { ProgramEditMilestoneForm } from './program-edit-milestone-form';

const milestone: EditableMilestone = {
  id: 'milestone-1',
  name: '중간 점검',
  startAt: '2026-08-10T09:30:59.000Z',
  dueAt: '2026-08-20T09:30:59.000Z',
  submissionType: 'TEXT',
  instructions: null,
};

describe('마일스톤 시작일 편집 계약', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('이름만 수정해도 실제 PATCH body에 기존 startAt을 유지한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: milestone.id }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const form = {
      ...toMilestoneForm(milestone),
      name: '중간 점검 안내 수정',
    };

    await updateMilestone(milestone.id, buildMilestoneInput(form, ['name']));

    expect(fetchMock).toHaveBeenCalledWith(
      apiPath(`milestones/${milestone.id}`),
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      name: '중간 점검 안내 수정',
      startAt: milestone.startAt,
    });
  });

  it('선택한 시작일과 마감일을 한 일정 요약에서 함께 보여 준다', () => {
    const html = renderToStaticMarkup(
      createElement(ProgramEditMilestoneForm, {
        editor: {
          mode: 'edit',
          form: {
            ...toMilestoneForm(milestone),
            startAt: '2026-09-01T09:00',
            dueAt: '2026-09-02T18:00',
          },
          errors: {},
        },
        operationStartAt: '2026-09-01T00:00',
        operationEndAt: '2026-09-30T23:59',
        contextEvents: [],
        isBusy: false,
        onCancel: () => undefined,
        onFieldChange: () => undefined,
        onSave: () => undefined,
      }),
    );
    const container = document.createElement('div');
    container.innerHTML = html;
    const summary = container.querySelector('[aria-live="polite"]');
    expect(summary?.textContent).toContain('2026년 9월 1일');
    expect(summary?.textContent).toContain('2026년 9월 2일');
    expect(container.querySelector('#milestone-start-at')).not.toBeNull();
    expect(container.querySelector('#milestone-due-at')).not.toBeNull();
  });
});
