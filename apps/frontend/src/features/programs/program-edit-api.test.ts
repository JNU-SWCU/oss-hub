import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiPath } from '@/lib/api-client';
import {
  createMilestone,
  deleteMilestone,
  deleteProgram,
  getEditableProgram,
  purgeProgram,
  type EditableProgram,
  updateMilestone,
  updateProgram,
} from './api';
import {
  isMilestoneSubmissionConflict,
  mapProgramEditError,
  PROGRAM_EDIT_ERROR_CODES,
  toMilestoneForm,
  toProgramEditForm,
} from './program-edit-flow';

const fetchMock = vi.fn();
const editableProgram: EditableProgram = {
  id: 'program-1',
  name: 'OSS',
  organizer: 'Center',
  category: 'OSS_CONTEST',
  lifecycle: 'PUBLISHED',
  applicationTemplateKey: 'oss-contest',
  applicationTemplateVersion: 1,
  applicationCount: 0,
  categoryLocked: {
    locked: false,
    byApplications: false,
    byTeams: false,
    applicationCount: 0,
    teamCount: 0,
  },
  applicationStartAt: '2026-08-01T09:30:59.000Z',
  applicationEndAt: '2026-08-15T09:30:59.000Z',
  startAt: '2026-08-16T09:30:59.000Z',
  endAt: '2026-08-31T09:30:59.000Z',
  repositoryProvisioningEnabled: false,
  notifyOnDeadline: false,
  description: 'overview',
  teamMinSize: 2,
  teamMaxSize: 4,
  milestones: [],
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('program edit API', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads editable fields through the guarded edit endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'program-1' }));

    await getEditableProgram('program-1');

    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('programs/program-1/edit'),
      undefined,
    );
  });

  it('accepts the editable contract without redundant top-level team count', async () => {
    const responseWithoutTopLevelTeamCount: EditableProgram = {
      ...editableProgram,
      categoryLocked: {
        locked: true,
        byApplications: false,
        byTeams: true,
        applicationCount: 0,
        teamCount: 3,
      },
    };
    fetchMock.mockResolvedValue(jsonResponse(responseWithoutTopLevelTeamCount));

    const program = await getEditableProgram('program-1');

    expect(program.categoryLocked.teamCount).toBe(3);
  });

  it('patches team fields through the canonical program endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'program-1' }));

    await updateProgram('program-1', {
      name: 'OSS',
      organizer: 'Center',
      category: 'OSS_CONTEST',
      applicationStartAt: '2026-08-01T00:00:00.000Z',
      applicationEndAt: '2026-08-15T00:00:00.000Z',
      startAt: '2026-08-16T00:00:00.000Z',
      endAt: '2026-08-31T00:00:00.000Z',
      repositoryProvisioningEnabled: false,
      notifyOnDeadline: false,
      description: 'overview',
      teamMinSize: 2,
      teamMaxSize: 4,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('programs/program-1'),
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      category: 'OSS_CONTEST',
      startAt: '2026-08-16T00:00:00.000Z',
      teamMinSize: 2,
      teamMaxSize: 4,
    });
  });

  it('keeps milestone mutations on canonical id endpoints and serializes startAt', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ id: 'milestone-1' })),
    );
    const input = {
      name: 'Final',
      startAt: '2026-08-16T00:00:00.000Z',
      dueAt: '2026-08-20T00:00:00.000Z',
      submissionType: 'TEXT' as const,
      instructions: 'tag',
    };

    await createMilestone('program-1', input);
    await updateMilestone('milestone-1', input);
    await deleteMilestone('milestone-1');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      apiPath('programs/program-1/milestones'),
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      apiPath('milestones/milestone-1'),
    );
    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)),
    ).toMatchObject({ startAt: input.startAt });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      apiPath('milestones/milestone-1'),
    );
  });

  it('uses the backend milestone response as the authoritative saved value', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 'milestone-1',
        name: '기획서 수정',
        startAt: '2026-05-02T00:00:00.000Z',
        dueAt: '2026-05-10T00:00:00.000Z',
        submissionType: 'TEXT',
        instructions: null,
      }),
    );
    const input = {
      name: '기획서 수정',
      startAt: '2026-05-01T00:00:00.000Z',
      dueAt: '2026-05-10T00:00:00.000Z',
      submissionType: 'TEXT' as const,
      instructions: null,
    };

    const saved = await updateMilestone('milestone-1', input);

    expect(saved.startAt).toBe('2026-05-02T00:00:00.000Z');
    expect(toMilestoneForm(saved).startAt).toBe('2026-05-02T09:00');
  });

  it('maps backend fieldErrors from the real ApiClient problem shape without clearing inputs', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'https://oss-hub.dev/problems/program-validation',
          title: 'Program validation failed',
          status: 400,
          detail: '입력값을 확인해 주세요.',
          instance: apiPath('programs/program-1'),
          code: PROGRAM_EDIT_ERROR_CODES.VALIDATION_ERROR,
          fieldErrors: [
            {
              field: 'name',
              code: PROGRAM_EDIT_ERROR_CODES.VALIDATION_ERROR,
              message: '프로그램명을 입력해 주세요.',
            },
            {
              field: 'applicationEndAt',
              code: PROGRAM_EDIT_ERROR_CODES.INVALID_APPLICATION_PERIOD,
              message: '신청 종료일을 확인해 주세요.',
            },
            {
              field: 'startAt',
              code: PROGRAM_EDIT_ERROR_CODES.VALIDATION_ERROR,
              message: '운영 시작일을 확인해 주세요.',
            },
          ],
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/problem+json' },
        },
      ),
    );
    const form = { ...toProgramEditForm(editableProgram), name: '작성 중' };

    const updatePromise = updateProgram('program-1', {
      name: editableProgram.name,
      organizer: editableProgram.organizer,
      category: editableProgram.category,
      applicationStartAt: editableProgram.applicationStartAt,
      applicationEndAt: editableProgram.applicationEndAt,
      startAt: editableProgram.startAt ?? editableProgram.applicationEndAt,
      endAt: editableProgram.endAt,
      repositoryProvisioningEnabled:
        editableProgram.repositoryProvisioningEnabled,
      notifyOnDeadline: editableProgram.notifyOnDeadline,
      description: editableProgram.description,
      teamMinSize: editableProgram.teamMinSize,
      teamMaxSize: editableProgram.teamMaxSize,
    });
    await expect(updatePromise).rejects.toBeInstanceOf(ApiError);
    const error = await updatePromise.catch((caught: unknown) => caught);

    expect(mapProgramEditError(error)).toMatchObject({
      name: '프로그램명을 입력해 주세요.',
      period: '신청 종료일을 확인해 주세요.',
      startAt: '운영 시작일을 확인해 주세요.',
    });
    expect(form.name).toBe('작성 중');
  });

  it('pins ADR-stable program editor error codes and detects submission conflicts', () => {
    expect(PROGRAM_EDIT_ERROR_CODES).toMatchObject({
      STAFF_APPROVAL_REQUIRED: 'PRG_003',
      INVALID_APPLICATION_PERIOD: 'PRG_007',
      MILESTONE_HAS_SUBMISSIONS: 'PRG_009',
      MILESTONE_REQUIRED: 'PRG_010',
    });
    const conflictProblem = {
      type: 'https://oss-hub.dev/problems/milestone-has-submissions',
      title: 'Milestone has submissions',
      status: 409,
      detail: '제출물이 있는 마일스톤은 삭제할 수 없습니다.',
      instance: apiPath('milestones/milestone-1'),
      code: PROGRAM_EDIT_ERROR_CODES.MILESTONE_HAS_SUBMISSIONS,
    };

    expect(isMilestoneSubmissionConflict(new ApiError(conflictProblem))).toBe(
      true,
    );
  });

  // #875 — ADMIN 전용 영구 삭제. DELETE 메서드와 canonical id 엔드포인트를 확인한다.
  it('deletes a program through the canonical id endpoint with DELETE', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 'program-1', deleted: true }),
    );

    await deleteProgram('program-1');

    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('programs/program-1'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  // TOCTOU(#F2) — purge는 확인 화면이 보여준 4종 범위(expectedScope)를 본문에 실어 보낸다.
  it('purges a program graph through the ADMIN purge endpoint with DELETE and the expected scope body', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 'program-1',
        deleted: true,
        deletedCounts: { applications: 2, notifications: 3 },
      }),
    );
    const expectedScope = {
      applications: 2,
      teams: 1,
      boardPosts: 0,
      submissions: 3,
      submissionEvents: 4,
      scopeFingerprint: '0123456789abcdef0123456789abcdef',
    };

    await purgeProgram('program-1', expectedScope);

    expect(fetchMock).toHaveBeenCalledWith(
      apiPath('programs/program-1/purge'),
      expect.objectContaining({
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedScope }),
      }),
    );
  });
});
