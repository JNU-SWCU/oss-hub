import { GUARDS_METADATA } from '@nestjs/common/constants';
import { TeamInvitationStatus } from '@prisma/client';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { CreateTeamInvitationRequestDto } from './dto/create-team-invitation-request.dto';
import { SearchInvitationCandidatesRequestDto } from './dto/search-invitation-candidates-request.dto';
import { TeamInvitationsController } from './team-invitations.controller';

const syntheticGithubId = 424242n;

/** `GET /team-invitations/received` 한 항목의 원본 — 요약까지 채운 완전한 모양. */
const receivedRecord = {
  id: 'cuid-invitation',
  teamId: 'cuid-team',
  programId: 'cuid-program',
  inviteeId: 'cuid-invitee',
  invitedById: 'cuid-leader',
  status: TeamInvitationStatus.PENDING,
  invitedAt: new Date('2026-08-01T00:00:00.000Z'),
  respondedAt: null,
  teamName: '합성 팀',
  programName: '합성 프로그램',
  invitedByDisplayName: '합성 팀장',
  memberCount: 2,
  teamMaxSize: 5,
};

function readMethodGuards(target: object, methodName: string): unknown[] {
  const method: unknown = Object.getOwnPropertyDescriptor(
    target,
    methodName,
  )?.value;
  if (typeof method !== 'function') return [];
  const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, method);
  return Array.isArray(guards) ? guards : [];
}

interface ServiceMocks {
  listReceived: jest.Mock;
  listSentByTeam: jest.Mock;
  searchCandidates: jest.Mock;
  create: jest.Mock;
  cancel: jest.Mock;
  decline: jest.Mock;
  accept: jest.Mock;
}

function buildController(overrides: Partial<ServiceMocks> = {}): {
  controller: TeamInvitationsController;
  mocks: ServiceMocks;
} {
  const mocks: ServiceMocks = {
    listReceived: jest.fn().mockResolvedValue([]),
    listSentByTeam: jest.fn().mockResolvedValue([]),
    searchCandidates: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    cancel: jest.fn().mockResolvedValue(undefined),
    decline: jest.fn().mockResolvedValue(undefined),
    accept: jest.fn(),
    ...overrides,
  };
  const controller = new TeamInvitationsController(
    mocks as unknown as ConstructorParameters<
      typeof TeamInvitationsController
    >[0],
  );
  return { controller, mocks };
}

describe('TeamInvitationsController', () => {
  it('컨트롤러 전체에 SessionGuard를 적용한다', () => {
    const classGuards: unknown = Reflect.getMetadata(
      GUARDS_METADATA,
      TeamInvitationsController,
    );
    expect(classGuards).toEqual([SessionGuard]);
  });

  it.each(['create', 'cancel', 'decline', 'accept'])(
    '%s 에 OriginGuard를 추가로 적용한다',
    (methodName) => {
      expect(
        readMethodGuards(TeamInvitationsController.prototype, methodName),
      ).toEqual([OriginGuard]);
    },
  );

  /**
   * 요약 필드는 **더한 것**이지 바꾼 것이 아니다. 이 경로에는 이미 소비자가 있고
   * (`features/programs/team-invitation-api.ts`의 팀 화면), 그쪽 검증기는 아래
   * 기존 필드들을 읽는다 — 하나라도 이름이 바뀌거나 빠지면 목록을 통째로 거절해
   * "초대가 하나도 없다"로 보인다. 기대값을 전부 적어 두어 그 순간 빨간불이 뜨게 한다.
   */
  it('listReceived는 service 결과를 팀·프로그램 요약까지 담은 DTO 배열로 반환한다', async () => {
    const { controller, mocks } = buildController({
      listReceived: jest.fn().mockResolvedValue([receivedRecord]),
    });

    const response = await controller.listReceived({
      sessionGithubId: syntheticGithubId,
    } as never);

    expect(mocks.listReceived).toHaveBeenCalledWith(syntheticGithubId);
    expect(response).toEqual([
      {
        id: 'cuid-invitation',
        teamId: 'cuid-team',
        programId: 'cuid-program',
        invitedById: 'cuid-leader',
        status: TeamInvitationStatus.PENDING,
        invitedAt: '2026-08-01T00:00:00.000Z',
        respondedAt: null,
        teamName: '합성 팀',
        programName: '합성 프로그램',
        invitedByDisplayName: '합성 팀장',
        memberCount: 2,
        teamMaxSize: 5,
      },
    ]);
  });

  it('search는 query.query를 trim 없이 service로 넘긴다', async () => {
    const { controller, mocks } = buildController();
    const query = Object.assign(new SearchInvitationCandidatesRequestDto(), {
      query: 'octocat',
    });

    await controller.search(
      { sessionGithubId: syntheticGithubId } as never,
      'cuid-team',
      query,
    );

    expect(mocks.searchCandidates).toHaveBeenCalledWith(
      syntheticGithubId,
      'cuid-team',
      'octocat',
    );
  });

  it('create는 body.inviteeUserId를 service로 넘기고 DTO로 반환한다', async () => {
    const created = {
      id: 'cuid-invitation',
      teamId: 'cuid-team',
      programId: 'cuid-program',
      inviteeId: 'cuid-invitee',
      invitedById: 'cuid-leader',
      status: TeamInvitationStatus.PENDING,
      invitedAt: new Date('2026-08-01T00:00:00.000Z'),
      respondedAt: null,
    };
    const { controller, mocks } = buildController({
      create: jest.fn().mockResolvedValue(created),
    });
    const body = Object.assign(new CreateTeamInvitationRequestDto(), {
      inviteeUserId: 'cuid-invitee',
    });

    const response = await controller.create(
      { sessionGithubId: syntheticGithubId } as never,
      'cuid-team',
      body,
    );

    expect(mocks.create).toHaveBeenCalledWith(
      syntheticGithubId,
      'cuid-team',
      'cuid-invitee',
    );
    expect(response.id).toBe('cuid-invitation');
  });

  it('cancel은 service.cancel을 호출한다', async () => {
    const { controller, mocks } = buildController();

    await controller.cancel(
      { sessionGithubId: syntheticGithubId } as never,
      'cuid-invitation',
    );

    expect(mocks.cancel).toHaveBeenCalledWith(
      syntheticGithubId,
      'cuid-invitation',
    );
  });

  it('decline은 service.decline을 호출한다', async () => {
    const { controller, mocks } = buildController();

    await controller.decline(
      { sessionGithubId: syntheticGithubId } as never,
      'cuid-invitation',
    );

    expect(mocks.decline).toHaveBeenCalledWith(
      syntheticGithubId,
      'cuid-invitation',
    );
  });

  it('accept는 service 결과를 DTO로 반환한다', async () => {
    const { controller, mocks } = buildController({
      accept: jest
        .fn()
        .mockResolvedValue({ teamId: 'cuid-team', programId: 'cuid-program' }),
    });

    const response = await controller.accept(
      { sessionGithubId: syntheticGithubId } as never,
      'cuid-invitation',
    );

    expect(mocks.accept).toHaveBeenCalledWith(
      syntheticGithubId,
      'cuid-invitation',
    );
    expect(response).toEqual({
      teamId: 'cuid-team',
      programId: 'cuid-program',
    });
  });
});
