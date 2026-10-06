import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import {
  createTeam,
  getMyTeam,
  getProgramDetail,
  listApplicationTemplates,
  removeMyTeamMember,
  type ProgramTeam,
} from './api';
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
  createTeam: vi.fn(),
  getMyTeam: vi.fn(),
  getProgramDetail: vi.fn(),
  listApplicationTemplates: vi.fn(),
  removeMyTeamMember: vi.fn(),
}));

vi.mock('./student-application-api', () => ({
  getMyApplication: vi.fn(),
}));

const program = {
  id: 'program-1',
  name: 'Team Program',
  organizer: 'Organizer',
  trackType: 'EXTRACURRICULAR',

  applicationTemplateKey: 'basic',
  lifecycle: 'PUBLISHED',
  description: 'Description',
  repositoryProvisioningEnabled: true,
  applicationPeriod: {
    startsAt: '2026-07-01T00:00:00.000Z',
    endsAt: '2026-07-31T23:59:59.000Z',
  },
  viewer: { role: 'STUDENT', applicationStatus: 'SUBMITTED' },
  milestones: [],
} satisfies ProgramDetail;

const openPeriod = {
  startsAt: '2020-01-01T00:00:00.000Z',
  endsAt: '2099-12-31T23:59:59.000Z',
} as const;

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

const teamTemplate = {
  ...template,
  key: 'oss-contest',
  participation: 'team',
} satisfies ApplicationFormTemplate;

const leaderTeam: ProgramTeam = {
  id: 'team-1',
  name: '기초스터디팀',
  memberCount: 2,
  minMembers: 2,
  maxMembers: 4,
  hasApplication: false,
  canInvite: true,
  canRemoveMembers: true,
  canLeave: true,
  isLeader: true,
  members: [
    { userId: 'user-1', nickname: 'leader', name: '팀장', isLeader: true },
    { userId: 'user-2', nickname: 'member', name: null, isLeader: false },
  ],
};

const invitedMemberTeam: ProgramTeam = {
  ...leaderTeam,
  hasApplication: true,
  canInvite: false,
  canRemoveMembers: false,
  canLeave: true,
  isLeader: false,
};

const application = {
  id: 'application-1',
  programId: 'program-1',
  status: 'SUBMITTED',
  teamId: 'team-1',
  answers: { applicantName: 'Applicant', title: 'Existing title' },
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

function problem(status: number, code: string) {
  return {
    type: 'about:blank',
    title: code,
    status,
    detail: `${code} detail`,
    instance: '/teams/me',
    code,
  };
}

const NO_TEAM = null;

function loadDefaultContext(): ReturnType<typeof loadProgramApplyContext> {
  return loadProgramApplyContext('program-1', sessionUser);
}

function openProgram(overrides: Partial<ProgramDetail> = {}): ProgramDetail {
  return {
    ...program,
    applicationPeriod: openPeriod,
    viewer: { role: 'STUDENT', applicationStatus: null },
    ...overrides,
  } as ProgramDetail;
}

describe('loadProgramApplyContext', () => {
  beforeEach(() => {
    vi.mocked(createTeam).mockReset();
    vi.mocked(removeMyTeamMember).mockReset();
    vi.mocked(getMyApplication).mockReset();
    vi.mocked(getMyTeam).mockReset();
    vi.mocked(getProgramDetail).mockReset();
    vi.mocked(listApplicationTemplates).mockReset();
    vi.mocked(getProgramDetail).mockResolvedValue(program);
    vi.mocked(listApplicationTemplates).mockResolvedValue([template]);
    vi.mocked(getMyApplication).mockResolvedValue(application);
    vi.mocked(getMyTeam).mockResolvedValue(NO_TEAM);
  });

  it('blocks a team member who cannot manage the application', async () => {
    const memberApplication = {
      ...application,
      isManager: false,
      canManage: false,
    };
    vi.mocked(getMyApplication).mockResolvedValue(memberApplication);

    const result = await loadDefaultContext();

    expect(result).toEqual({
      kind: 'blocked',
      reason: 'manage-not-allowed',
      program,
      application: memberApplication,
    });
  });

  it('blocks a submitted application as period-closed when it cannot be edited', async () => {
    const readonlyApplication = { ...application, canManage: false };
    vi.mocked(getMyApplication).mockResolvedValue(readonlyApplication);

    const result = await loadDefaultContext();

    expect(result).toEqual({
      kind: 'blocked',
      reason: 'period-closed',
      program,
      application: readonlyApplication,
    });
  });

  it('blocks a decided application as already-applied even after the period closes', async () => {
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

    const result = await loadDefaultContext();

    expect(result).toEqual({
      kind: 'blocked',
      reason: 'already-applied',
      program: decidedProgram,
      application: decidedApplication,
    });
    expect(getMyApplication).toHaveBeenCalledWith('program-1');
  });

  it('승인된 신청만 already-applied 로 막는다', async () => {
    const approvedProgram = {
      ...program,
      viewer: { role: 'STUDENT', applicationStatus: 'APPROVED' },
    } satisfies ProgramDetail;
    const approvedApplication = {
      ...application,
      status: 'APPROVED',
      canManage: false,
    } satisfies StudentApplication;
    vi.mocked(getProgramDetail).mockResolvedValue(approvedProgram);
    vi.mocked(getMyApplication).mockResolvedValue(approvedApplication);

    const result = await loadDefaultContext();

    expect(result).toEqual({
      kind: 'blocked',
      reason: 'already-applied',
      program: approvedProgram,
      application: approvedApplication,
    });
  });

  it('반려는 판정이 아니라 기간·권한으로만 막는다', async () => {
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

    const result = await loadDefaultContext();

    expect(result).toEqual({
      kind: 'blocked',

      reason: 'period-closed',
      program: rejectedProgram,
      application: rejectedApplication,
    });
  });

  it('팀이 없으면 자기 팀을 만들 수 있는 상태로 열되 아무것도 쓰지 않는다', async () => {
    vi.mocked(listApplicationTemplates).mockResolvedValue([teamTemplate]);
    vi.mocked(getProgramDetail).mockResolvedValue(
      openProgram({ applicationTemplateKey: 'oss-contest' }),
    );

    const result = await loadDefaultContext();

    expect(result).toMatchObject({
      kind: 'ready',
      mode: 'create',
      teamId: null,
      teamMinimum: null,
      team: null,
      applicationId: null,
      rejectionReason: null,

      canManage: true,
      initialValues: {
        isRepositoryPublicationPlanned: true,
        personalDataConsent: false,
      },
    });
    expect(getMyTeam).toHaveBeenCalledWith('program-1');

    expect(createTeam).not.toHaveBeenCalled();
    expect(removeMyTeamMember).not.toHaveBeenCalled();
  });

  it('예전 개인형 양식도 인증된 팀 조회로 기존 팀을 이어받는다', async () => {
    vi.mocked(getProgramDetail).mockResolvedValue(openProgram());
    vi.mocked(getMyTeam).mockResolvedValue(leaderTeam);

    const result = await loadDefaultContext();

    expect(getMyTeam).toHaveBeenCalledWith('program-1');
    expect(result).toMatchObject({
      kind: 'ready',
      mode: 'create',
      template,
      teamId: 'team-1',
      teamMinimum: { memberCount: 2, teamMinSize: 2 },
      team: leaderTeam,
      canManage: true,
    });
  });

  it('팀형 프로그램의 새 신청 상태에는 GitHub handle과 현재 팀을 함께 담는다', async () => {
    const noApplicationProgram = openProgram({
      applicationTemplateKey: 'oss-contest',
    });
    vi.mocked(listApplicationTemplates).mockResolvedValue([teamTemplate]);
    vi.mocked(getProgramDetail).mockResolvedValue(noApplicationProgram);
    vi.mocked(getMyTeam).mockResolvedValue(leaderTeam);

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
      team: leaderTeam,
      applicationId: null,
      rejectionReason: null,
      canManage: true,
      initialValues: {
        isRepositoryPublicationPlanned: true,
        personalDataConsent: false,
      },
    });
  });

  it('초대로 합류한 팀원은 신청서를 쓸 수 없는 상태로 연다', async () => {
    vi.mocked(getProgramDetail).mockResolvedValue(openProgram());
    vi.mocked(getMyTeam).mockResolvedValue(invitedMemberTeam);

    const result = await loadDefaultContext();

    expect(result).toMatchObject({
      kind: 'ready',
      mode: 'create',
      teamId: 'team-1',
      team: invitedMemberTeam,
      canManage: false,
    });
    expect(createTeam).not.toHaveBeenCalled();
  });

  it('returns edit state only when a submitted application can be edited', async () => {
    vi.mocked(getMyTeam).mockResolvedValue(leaderTeam);

    const result = await loadDefaultContext();

    expect(result).toEqual({
      kind: 'ready',
      mode: 'edit',
      program,
      template,
      applicantName: 'Applicant',
      githubHandle: 'applicant',
      teamId: 'team-1',
      teamMinimum: null,
      team: leaderTeam,
      applicationId: 'application-1',
      rejectionReason: null,
      canManage: true,
      initialValues: {
        title: 'Existing title',
        isRepositoryPublicationPlanned: false,
        personalDataConsent: true,
      },
    });
  });

  it('converges to create state when another tab already cancelled the application', async () => {
    vi.mocked(getMyApplication).mockResolvedValue(null);

    const result = await loadDefaultContext();

    expect(result).toEqual({
      kind: 'failed',
      message: '신청 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.',
    });
  });

  it.each([
    ['서버 오류', problem(500, 'SYS_001')],
    ['프로그램 없음(404)', problem(404, 'TEAM_002')],
    ['권한 거부', problem(403, 'TEAM_001')],
  ])('팀 조회 실패(%s)를 팀 없음으로 위조하지 않는다', async (_label, raw) => {
    vi.mocked(getProgramDetail).mockResolvedValue(openProgram());
    vi.mocked(getMyTeam).mockRejectedValue(new ApiError(raw));

    const result = await loadDefaultContext();

    expect(result).not.toMatchObject({ kind: 'ready' });
    expect(result.kind === 'failed' || result.kind === 'not-found').toBe(true);
  });

  it('팀 응답이 계약을 벗어나면 팀 없는 준비 상태로 넘기지 않는다', async () => {
    vi.mocked(getProgramDetail).mockResolvedValue(openProgram());
    vi.mocked(getMyTeam).mockRejectedValue(
      new Error('팀 응답 형식이 올바르지 않습니다.'),
    );

    const result = await loadDefaultContext();

    expect(result).toEqual({
      kind: 'failed',
      message: '신청 양식을 불러오지 못했습니다.',
    });
  });

  it('신청 양식 목록을 못 읽으면 로컬 기본 양식으로 대신하지 않는다', async () => {
    vi.mocked(getProgramDetail).mockResolvedValue(openProgram());
    vi.mocked(listApplicationTemplates).mockRejectedValue(
      new ApiError(problem(503, 'SYS_002')),
    );

    const result = await loadDefaultContext();

    expect(result).toEqual({ kind: 'failed', message: 'SYS_002 detail' });
    expect(getMyTeam).not.toHaveBeenCalled();
  });

  it('shared session 스냅샷으로 신청자 표시를 채운다', async () => {
    vi.mocked(getProgramDetail).mockResolvedValue(openProgram());

    const result = await loadProgramApplyContext('program-1', {
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
