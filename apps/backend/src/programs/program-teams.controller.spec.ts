import { GUARDS_METADATA } from '@nestjs/common/constants';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { CreateTeamRequestDto } from './dto/create-team-request.dto';
import { JoinTeamRequestDto } from './dto/join-team-request.dto';
import { ProgramTeamsController } from './program-teams.controller';
import type { ProgramTeamsService } from './program-teams.service';

function readGuards(
  target: object,
  methodName: 'create' | 'join' | 'me',
): unknown[] {
  const method: unknown = Object.getOwnPropertyDescriptor(
    target,
    methodName,
  )?.value;
  if (typeof method !== 'function') return [];
  const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, method);
  return Array.isArray(guards) ? guards : [];
}

describe('ProgramTeamsController', () => {
  it('create·join 에 SessionGuard·OriginGuard 를 적용한다', () => {
    expect(readGuards(ProgramTeamsController.prototype, 'create')).toEqual([
      SessionGuard,
      OriginGuard,
    ]);
    expect(readGuards(ProgramTeamsController.prototype, 'join')).toEqual([
      SessionGuard,
      OriginGuard,
    ]);
  });

  it('me 에 SessionGuard 를 적용한다', () => {
    expect(readGuards(ProgramTeamsController.prototype, 'me')).toEqual([
      SessionGuard,
    ]);
  });

  it('create 는 service 결과를 CreateTeamResponseDto 로 반환한다', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'team-1',
      name: '오픈소스팀',
      joinCode: 'ABCD1234XY',
      memberCount: 1,
    });
    const service: Pick<ProgramTeamsService, 'create' | 'join' | 'getMe'> = {
      create,
      join: jest.fn(),
      getMe: jest.fn(),
    };
    const controller = new ProgramTeamsController(service);
    const body = Object.assign(new CreateTeamRequestDto(), {
      name: '오픈소스팀',
    });

    const response = await controller.create(
      { sessionGithubId: 4242n },
      'program-1',
      body,
    );

    expect(create).toHaveBeenCalledWith(4242n, 'program-1', '오픈소스팀');
    expect(response).toEqual({
      id: 'team-1',
      name: '오픈소스팀',
      joinCode: 'ABCD1234XY',
      memberCount: 1,
    });
  });

  it('join 은 service 결과를 ProgramTeamResponseDto 로 반환한다', async () => {
    const join = jest.fn().mockResolvedValue({
      id: 'team-1',
      name: '오픈소스팀',
      memberCount: 2,
      minMembers: 2,
      maxMembers: 4,
      locked: false,
      isLeader: false,
      members: [],
    });
    const service: Pick<ProgramTeamsService, 'create' | 'join' | 'getMe'> = {
      create: jest.fn(),
      join,
      getMe: jest.fn(),
    };
    const controller = new ProgramTeamsController(service);
    const body = Object.assign(new JoinTeamRequestDto(), {
      joinCode: 'ABCD1234XY',
    });

    const response = await controller.join(
      { sessionGithubId: 4242n },
      'program-1',
      body,
    );

    expect(join).toHaveBeenCalledWith(4242n, 'program-1', 'ABCD1234XY');
    expect(response).toMatchObject({
      id: 'team-1',
      memberCount: 2,
      locked: false,
    });
    expect(response).not.toHaveProperty('joinCode');
  });

  it('me 는 service.getMe 결과를 반환한다', async () => {
    const getMe = jest.fn().mockResolvedValue({
      id: 'team-1',
      name: '오픈소스팀',
      memberCount: 1,
      minMembers: 2,
      maxMembers: 4,
      locked: false,
      isLeader: true,
      members: [],
    });
    const service: Pick<ProgramTeamsService, 'create' | 'join' | 'getMe'> = {
      create: jest.fn(),
      join: jest.fn(),
      getMe,
    };
    const controller = new ProgramTeamsController(service);

    const response = await controller.me(
      { sessionGithubId: 4242n },
      'program-1',
    );

    expect(getMe).toHaveBeenCalledWith(4242n, 'program-1');
    expect(response.id).toBe('team-1');
  });
});
