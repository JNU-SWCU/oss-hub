import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
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
  repositoryProvisioningEnabled: true,
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
  rejectionReason: null,
  isManager: true,
  canManage: true,
  canEdit: true,
  canCancel: true,
} satisfies StudentApplication;

const sessionUser = {
  name: 'Applicant',
  nickname: 'applicant',
} as const;

function loadDefaultContext(): ReturnType<typeof loadProgramApplyContext> {
  return loadProgramApplyContext('program-1', null, sessionUser);
}

describe('loadProgramApplyContext', () => {
  beforeEach(() => {
    vi.mocked(getMyApplication).mockReset();
    vi.mocked(getMyTeam).mockReset();
    vi.mocked(getProgramDetail).mockReset();
    vi.mocked(listApplicationTemplates).mockReset();
    vi.mocked(getProgramDetail).mockResolvedValue(program);
    vi.mocked(listApplicationTemplates).mockResolvedValue([template]);
    vi.mocked(getMyApplication).mockResolvedValue(application);
  });

  /**
   * 팀원은 신청서를 읽지만 고치거나 취소하지 못한다(#1083). 기간이 남아 있는데
   * 「신청 기간이 아닙니다」라고 하면 기다리면 열릴 줄 알고, 팀장에게 말할 생각을
   * 못 한다. 막는 이유를 서버가 실어 보낸 `isManager`로 가른다.
   */
  it('blocks a team member who cannot manage the application', async () => {
    // Given
    const memberApplication = {
      ...application,
      isManager: false,
      canManage: false,
    };
    vi.mocked(getMyApplication).mockResolvedValue(memberApplication);

    // When
    const result = await loadDefaultContext();

    // Then
    expect(result).toEqual({
      kind: 'blocked',
      reason: 'manage-not-allowed',
      program,
      application: memberApplication,
    });
  });

  it('blocks a submitted application as period-closed when it cannot be edited', async () => {
    // Given
    const readonlyApplication = { ...application, canManage: false };
    vi.mocked(getMyApplication).mockResolvedValue(readonlyApplication);

    // When
    const result = await loadDefaultContext();

    // Then
    expect(result).toEqual({
      kind: 'blocked',
      reason: 'period-closed',
      program,
      application: readonlyApplication,
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
      canManage: false,
    } satisfies StudentApplication;
    vi.mocked(getProgramDetail).mockResolvedValue(decidedProgram);
    vi.mocked(getMyApplication).mockResolvedValue(decidedApplication);

    // When
    const result = await loadDefaultContext();

    // Then
    expect(result).toEqual({
      kind: 'blocked',
      reason: 'already-applied',
      program: decidedProgram,
      application: decidedApplication,
    });
    expect(getMyApplication).toHaveBeenCalledWith('program-1');
  });

  /**
   * 반려 사유는 `getMyApplication` 응답에만 실려 온다(#722). 예전에는 이 판정 직후
   * 응답 객체를 버려서, 화면이 사유를 그리려 해도 꺼낼 곳이 없었다.
   */
  it('반려로 막을 때 사유가 실린 신청서를 함께 넘긴다', async () => {
    // Given
    const rejectedProgram = {
      ...program,
      viewer: { role: 'STUDENT', applicationStatus: 'REJECTED' },
    } satisfies ProgramDetail;
    const rejectedApplication = {
      ...application,
      status: 'REJECTED',
      canManage: false,
      rejectionReason: '제출한 요약이 프로그램 주제와 맞지 않습니다.',
    } satisfies StudentApplication;
    vi.mocked(getProgramDetail).mockResolvedValue(rejectedProgram);
    vi.mocked(getMyApplication).mockResolvedValue(rejectedApplication);

    // When
    const result = await loadDefaultContext();

    // Then
    expect(result).toEqual({
      kind: 'blocked',
      reason: 'already-applied',
      program: rejectedProgram,
      application: rejectedApplication,
    });
  });

  // 신청서를 조회하지도 않은 갈래는 `null`이다 — 없는 값을 지어내지 않는다.
  it('신청 전 팀 미구성에서도 신청서 단계로 계속할 수 있다', async () => {
    // Given
    const teamTemplate = {
      ...template,
      key: 'oss-contest',
      participation: 'team',
    } satisfies ApplicationFormTemplate;
    const noApplicationProgram = {
      ...program,
      category: 'OSS_CONTEST',
      applicationPeriod: {
        startsAt: '2020-01-01T00:00:00.000Z',
        endsAt: '2099-12-31T23:59:59.000Z',
      },
      viewer: { role: 'STUDENT', applicationStatus: null },
    } satisfies ProgramDetail;
    vi.mocked(listApplicationTemplates).mockResolvedValue([teamTemplate]);
    vi.mocked(getProgramDetail).mockResolvedValue(noApplicationProgram);
    vi.mocked(getMyTeam).mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Not found',
        status: 404,
        detail: 'Team not found',
        instance: '/teams/me',
        code: 'TEAM_001',
      }),
    );

    // When
    const result = await loadDefaultContext();

    // Then
    expect(result).toMatchObject({
      kind: 'ready',
      mode: 'create',
      program: noApplicationProgram,
      teamId: null,
      teamMinimum: null,
      team: null,
      applicationId: null,
      initialValues: {
        summary: '',
        isRepositoryPublicationPlanned: true,
        repositoryConnectionMode: 'new',
        repositoryUrl: '',
        personalDataConsent: false,
      },
    });
  });

  it('returns edit state only when a submitted application can be edited', async () => {
    // Given
    const editableApplication = application;
    vi.mocked(getMyApplication).mockResolvedValue(editableApplication);

    // When
    const result = await loadDefaultContext();

    // Then
    expect(result).toEqual({
      kind: 'ready',
      mode: 'edit',
      program,
      template,
      applicantName: 'Applicant',
      githubHandle: 'applicant',
      teamId: 'team-1',
      teamMinimum: null,
      team: null,
      applicationId: 'application-1',
      canManage: true,
      initialValues: {
        summary: 'Existing summary',
        isRepositoryPublicationPlanned: false,
        repositoryConnectionMode: 'new',
        repositoryUrl: '',
        personalDataConsent: true,
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

    const result = await loadDefaultContext();

    expect(result).toEqual({
      kind: 'failed',
      message: '신청 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.',
    });
  });

  it('팀형 프로그램의 새 신청 상태에는 GitHub handle과 현재 팀을 함께 담는다', async () => {
    // `resolveProgramApplicationTemplate`는 program.category로 정의를 고르고
    // 그 정의의 key와 일치하는 템플릿만 API 응답에서 받아들인다(program-templates.ts).
    // 팀형 정의(OSS_CONTEST)의 key는 'oss-contest'다.
    const teamTemplate = {
      ...template,
      key: 'oss-contest',
      participation: 'team',
    } satisfies ApplicationFormTemplate;
    const noApplicationProgram = {
      ...program,
      category: 'OSS_CONTEST',
      // 신청 기간 판별은 실제 현재 시각(Date.now())을 쓴다 — 테스트가 언제
      // 돌아도 열려 있도록 마감을 충분히 미래로 둔다.
      applicationPeriod: {
        startsAt: '2020-01-01T00:00:00.000Z',
        endsAt: '2099-12-31T23:59:59.000Z',
      },
      viewer: { role: 'STUDENT', applicationStatus: null },
    } satisfies ProgramDetail;
    const team = {
      id: 'team-1',
      name: 'Synthetic Team',
      memberCount: 2,
      minMembers: 2,
      maxMembers: 4,
      locked: false,
      isLeader: true,
      members: [
        { userId: 'user-1', nickname: 'leader', name: '팀장', isLeader: true },
        { userId: 'user-2', nickname: 'member', name: null, isLeader: false },
      ],
    };
    vi.mocked(listApplicationTemplates).mockResolvedValue([teamTemplate]);
    vi.mocked(getProgramDetail).mockResolvedValue(noApplicationProgram);
    vi.mocked(getMyTeam).mockResolvedValue(team);

    const result = await loadDefaultContext();

    expect(result).toEqual({
      kind: 'ready',
      mode: 'create',
      program: noApplicationProgram,
      template: teamTemplate,
      applicantName: 'Applicant',
      githubHandle: 'applicant',
      teamId: 'team-1',
      teamMinimum: { memberCount: 2, teamMinSize: 2 },
      team,
      applicationId: null,
      canManage: false,
      initialValues: {
        summary: '',
        isRepositoryPublicationPlanned: true,
        repositoryConnectionMode: 'new',
        repositoryUrl: '',
        personalDataConsent: false,
      },
    });
  });

  it('shared session 스냅샷으로 신청자 표시를 채운다', async () => {
    const noApplicationProgram = {
      ...program,
      applicationPeriod: {
        startsAt: '2020-01-01T00:00:00.000Z',
        endsAt: '2099-12-31T23:59:59.000Z',
      },
      viewer: { role: 'STUDENT', applicationStatus: null },
    } satisfies ProgramDetail;
    vi.mocked(getProgramDetail).mockResolvedValue(noApplicationProgram);
    const result = await loadProgramApplyContext('program-1', null, {
      name: 'Shared Applicant',
      nickname: 'shared-applicant',
    });

    expect(result).toMatchObject({
      kind: 'ready',
      applicantName: 'Shared Applicant',
      githubHandle: 'shared-applicant',
    });
  });
});
