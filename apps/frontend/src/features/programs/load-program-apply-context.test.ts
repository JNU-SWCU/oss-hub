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

/** 신청 기간 판별은 실제 현재 시각(Date.now())을 쓴다 — 언제 돌려도 열려 있게 둔다. */
const openPeriod = {
  startsAt: '2020-01-01T00:00:00.000Z',
  endsAt: '2099-12-31T23:59:59.000Z',
} as const;

/** #1269 이전의 「개인형」 템플릿. 지금은 이 양식도 자기 팀을 만들어 신청한다. */
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

/** backend `GET /programs/:id/teams/me` 가 실제로 내려주는 모양(능력 플래그 포함). */
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

/** 초대를 받아 합류한 팀원 — 팀장이 아니므로 신청서를 쓰지 못한다. */
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

/** 서버가 「소속된 팀이 없습니다」라고 말하는 단 하나의 실패. */
const noTeamError = new ApiError(problem(404, 'TEAM_010'));

function loadDefaultContext(): ReturnType<typeof loadProgramApplyContext> {
  return loadProgramApplyContext('program-1', sessionUser);
}

/** 신청 전(create) 갈래를 열어 두는 프로그램. */
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
    vi.mocked(getMyTeam).mockRejectedValue(noTeamError);
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
  it('팀이 없으면 자기 팀을 만들 수 있는 상태로 열되 아무것도 쓰지 않는다', async () => {
    // Given
    vi.mocked(listApplicationTemplates).mockResolvedValue([teamTemplate]);
    vi.mocked(getProgramDetail).mockResolvedValue(
      openProgram({ applicationTemplateKey: 'oss-contest' }),
    );

    // When
    const result = await loadDefaultContext();

    // Then
    expect(result).toMatchObject({
      kind: 'ready',
      mode: 'create',
      teamId: null,
      teamMinimum: null,
      team: null,
      applicationId: null,
      // 팀이 없는 사람은 자기 팀의 팀장이 될 사람이다.
      canManage: true,
      initialValues: {
        isRepositoryPublicationPlanned: true,
        repositoryConnectionMode: 'new',
        repositoryUrl: '',
        personalDataConsent: false,
      },
    });
    expect(getMyTeam).toHaveBeenCalledWith('program-1');
    // 로더는 읽기만 한다 — 화면을 열었다는 이유로 팀이 생기지 않는다.
    expect(createTeam).not.toHaveBeenCalled();
    expect(removeMyTeamMember).not.toHaveBeenCalled();
  });

  /**
   * #1269: 예전 `individual` 템플릿은 팀 조회 자체를 건너뛰어, 팀 이름을 지은 뒤
   * 새로고침하면 만든 팀이 사라진 것처럼 보였다. 이제 모든 양식이 같은 경로로
   * 인증된 세션의 팀을 다시 읽어 이어서 진행한다.
   */
  it('예전 개인형 양식도 인증된 팀 조회로 기존 팀을 이어받는다', async () => {
    // Given — 기본(basic) 양식, 이미 만들어 둔 내 팀
    vi.mocked(getProgramDetail).mockResolvedValue(openProgram());
    vi.mocked(getMyTeam).mockResolvedValue(leaderTeam);

    // When
    const result = await loadDefaultContext();

    // Then
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
    // `resolveProgramApplicationTemplate`는 program.applicationTemplateKey로
    // 정의를 고르고 그 key와 일치하는 템플릿만 API 응답에서 받아들인다.
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
      canManage: true,
      initialValues: {
        isRepositoryPublicationPlanned: true,
        repositoryConnectionMode: 'new',
        repositoryUrl: '',
        personalDataConsent: false,
      },
    });
  });

  /**
   * 초대로 합류한 팀원이 신청서를 또 쓰면 같은 팀 이름으로 신청이 둘 생긴다.
   * 권한은 서버가 계산한 `isLeader` 하나로 판단하고 화면이 다시 유추하지 않는다.
   */
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
    // Given — 수정 권한은 서버 `canManage`가 정한다(과거 신청자였다는 사실이 아니라).
    vi.mocked(getMyTeam).mockResolvedValue(leaderTeam);

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
      team: leaderTeam,
      applicationId: 'application-1',
      canManage: true,
      initialValues: {
        title: 'Existing title',
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

  /**
   * 팀 조회가 실패했다는 것과 팀이 없다는 것은 다른 사실이다. 뭉뚱그리면 이미
   * 팀에 속한 학생에게 팀 만들기를 권해, 서버 거절(TEAM_006)로 끝나는 길을 안내한다.
   */
  it.each([
    ['서버 오류', problem(500, 'SYS_001')],
    ['프로그램 없음이 아닌 404', problem(404, 'TEAM_002')],
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

  /**
   * 템플릿 목록 실패를 삼키면 로컬 기본값(version 1)으로 만든 가짜 양식을 제출해
   * 서버가 APP_016으로 되돌린다. 학생은 무엇이 잘못됐는지 알 수 없다.
   */
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
