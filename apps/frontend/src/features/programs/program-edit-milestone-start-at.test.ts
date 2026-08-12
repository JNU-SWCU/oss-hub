import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { updateMilestone, type EditableMilestone } from './api';
import { buildMilestoneInput, toMilestoneForm } from './program-edit-flow';

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
});
