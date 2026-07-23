import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiPath } from '@/lib/api-client';
import {
  createMilestone,
  deleteMilestone,
  getEditableProgram,
  type EditableProgram,
  updateMilestone,
  updateProgram,
} from './api';
import {
  isMilestoneSubmissionConflict,
  mapProgramEditError,
  PROGRAM_EDIT_ERROR_CODES,
  toProgramEditForm,
} from './program-edit-flow';

const fetchMock = vi.fn();
const editableProgram: EditableProgram = {
  id: 'program-1',
  name: 'OSS',
  organizer: 'Center',
  category: 'OSS_CONTEST',
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
  repositoryProvisioningEnabled: false,
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
      repositoryProvisioningEnabled: false,
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
      teamMinSize: 2,
      teamMaxSize: 4,
    });
  });

  it('keeps milestone mutations on canonical id endpoints', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ id: 'milestone-1' })),
    );
    const input = {
      name: 'Final',
      dueAt: '2026-08-20T00:00:00.000Z',
      submissionType: 'REPOSITORY_RELEASE' as const,
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
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      apiPath('milestones/milestone-1'),
    );
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
      repositoryProvisioningEnabled:
        editableProgram.repositoryProvisioningEnabled,
      description: editableProgram.description,
      teamMinSize: editableProgram.teamMinSize,
      teamMaxSize: editableProgram.teamMaxSize,
    });
    await expect(updatePromise).rejects.toBeInstanceOf(ApiError);
    const error = await updatePromise.catch((caught: unknown) => caught);

    expect(mapProgramEditError(error)).toMatchObject({
      name: '프로그램명을 입력해 주세요.',
      period: '신청 종료일을 확인해 주세요.',
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
});
