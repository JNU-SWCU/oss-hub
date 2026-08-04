import { GUARDS_METADATA } from '@nestjs/common/constants';
import { TeamInvitationStatus } from '@prisma/client';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { CreateTeamInvitationRequestDto } from './dto/create-team-invitation-request.dto';
import { SearchInvitationCandidatesRequestDto } from './dto/search-invitation-candidates-request.dto';
import { TeamInvitationsController } from './team-invitations.controller';

const syntheticGithubId = 424242n;

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
    mocks as unknown as ConstructorParameters<typeof TeamInvitationsController>[0],
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

  it('listReceived는 service 결과를 DTO 배열로 반환한다', async () => {
    const invitation = {
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
      listReceived: jest.fn().mockResolvedValue([invitation]),
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
    expect(response).toEqual({ teamId: 'cuid-team', programId: 'cuid-program' });
  });
});
