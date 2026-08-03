import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient, ApiError } from '@/lib/api-client';
import { getMyTeam, getProgramDetail, listApplicationTemplates } from './api';
import { loadProgramApplyContext } from './load-program-apply-context';
import {
  getMyApplication,
  type StudentApplication,
} from './student-application-api';
import type { ApplicationFormTemplate, ProgramDetail } from './types';

vi.mock('@/lib/api-client', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      readonly problem: { readonly status: number; readonly code: string },
    ) {
      super(problem.code);
    }
  },
  apiClient: vi.fn(),
}));

vi.mock('./api', () => ({
  getMyTeam: vi.fn(),
  getProgramDetail: vi.fn(),
  listApplicationTemplates: vi.fn(),
}));

vi.mock('./student-application-api', () => ({
  getMyApplication: vi.fn(),
}));

const program = {
  id: 'program-1',
  name: 'Team Program',
  organizer: 'Organizer',
  category: 'BASIC',
  description: 'Description',
  applicationPeriod: {
    startsAt: '2026-07-01T00:00:00.000Z',
    endsAt: '2026-07-31T23:59:59.000Z',
  },
  viewer: { role: 'STUDENT', applicationStatus: 'SUBMITTED' },
  milestones: [],
} satisfies ProgramDetail;

const template = {
  key: 'basic',
  version: 1,
  name: 'Basic application',
  participation: 'individual',
  fields: [
    { key: 'applicantName', type: 'auto', label: 'Applicant', required: true },
    { key: 'title', type: 'text', label: 'Title', required: true },
    { key: 'summary', type: 'textarea', label: 'Summary', required: true },
  ],
} satisfies ApplicationFormTemplate;

const application = {
  id: 'application-1',
  programId: 'program-1',
  status: 'SUBMITTED',
  teamId: 'team-1',
  answers: {
    applicantName: 'Applicant',
    title: 'Existing title',
    summary: 'Existing summary',
  },
  submittedAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-16T00:00:00.000Z',
  isRepositoryPublicationPlanned: false,
  canEdit: true,
  canCancel: true,
} satisfies StudentApplication;

describe('loadProgramApplyContext', () => {
  beforeEach(() => {
    vi.mocked(apiClient).mockReset();
    vi.mocked(getMyApplication).mockReset();
    vi.mocked(getMyTeam).mockReset();
    vi.mocked(getProgramDetail).mockReset();
    vi.mocked(listApplicationTemplates).mockReset();
    vi.mocked(apiClient).mockResolvedValue({
      isAuthenticated: true,
      user: { name: 'Applicant', nickname: 'applicant' },
    });
    vi.mocked(getProgramDetail).mockResolvedValue(program);
    vi.mocked(listApplicationTemplates).mockResolvedValue([template]);
    vi.mocked(getMyApplication).mockResolvedValue(application);
  });

  it('blocks a submitted application as period-closed when it cannot be edited', async () => {
    // Given
    const readonlyApplication = { ...application, canEdit: false };
    vi.mocked(getMyApplication).mockResolvedValue(readonlyApplication);

    // When
    const result = await loadProgramApplyContext('program-1', null);

    // Then
    expect(result).toEqual({
      kind: 'blocked',
      reason: 'period-closed',
      program,
    });
  });

  it('blocks a decided application as already-applied even after the period closes', async () => {
    // Given
    const decidedProgram = {
      ...program,
      viewer: { role: 'STUDENT', applicationStatus: 'APPROVED' },
    } satisfies ProgramDetail;
    const decidedApplication = {
      ...application,
      status: 'APPROVED',
      canEdit: false,
      canCancel: false,
    } satisfies StudentApplication;
    vi.mocked(getProgramDetail).mockResolvedValue(decidedProgram);
    vi.mocked(getMyApplication).mockResolvedValue(decidedApplication);

    // When
    const result = await loadProgramApplyContext('program-1', null);

    // Then
    expect(result).toEqual({
      kind: 'blocked',
      reason: 'already-applied',
      program: decidedProgram,
    });
    expect(getMyApplication).toHaveBeenCalledWith('program-1');
  });

  it('returns edit state only when a submitted application can be edited', async () => {
    // Given
    const editableApplication = { ...application, canCancel: false };
    vi.mocked(getMyApplication).mockResolvedValue(editableApplication);

    // When
    const result = await loadProgramApplyContext('program-1', null);

    // Then
    expect(result).toEqual({
      kind: 'ready',
      mode: 'edit',
      program,
      template,
      applicantName: 'Applicant',
      teamId: 'team-1',
      applicationId: 'application-1',
      canCancel: false,
      initialValues: {
        title: 'Existing title',
        summary: 'Existing summary',
        isRepositoryPublicationPlanned: false,
      },
    });
  });

  it('converges to create state when another tab already cancelled the application', async () => {
    vi.mocked(getMyApplication).mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Not found',
        status: 404,
        detail: 'Application not found',
        instance: '/applications/me',
        code: 'APP_001',
      }),
    );

    const result = await loadProgramApplyContext('program-1', null);

    expect(result).toMatchObject({ kind: 'ready', mode: 'create' });
  });
});
