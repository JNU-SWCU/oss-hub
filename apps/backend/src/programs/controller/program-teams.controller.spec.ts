import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { OriginGuard } from '../../auth/origin.guard';
import { SessionGuard } from '../../auth/session.guard';
import { CreateTeamRequestDto } from '../dto/create-team-request.dto';
import { JoinTeamRequestDto } from '../dto/join-team-request.dto';
import { ProgramTeamsController } from './program-teams.controller';
import { ProgramTeamsStaffGuard } from '../program-teams-staff.guard';
import type { ProgramTeamsService } from '../service/program-teams.service';

function readGuards(
  target: object,
  methodName: 'create' | 'join' | 'me' | 'list' | 'detail',
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

  it('list(교직원 팀 목록) 에 SessionGuard·ProgramTeamsStaffGuard 를 적용한다', () => {
    expect(readGuards(ProgramTeamsController.prototype, 'list')).toEqual([
      SessionGuard,
      ProgramTeamsStaffGuard,
    ]);
  });

  /**
   * 정적 형제 우선 규칙(`programs.controller.ts`) — `GET me` 가 `GET ''` 보다 먼저
   * 선언돼 있어야 한다. Nest 는 선언 순서대로 라우트를 등록한다.
   */
  it('GET me 를 GET (목록) 보다 먼저 선언한다', () => {
    const methods = Object.getOwnPropertyNames(
      ProgramTeamsController.prototype,
    );
    expect(methods.indexOf('me')).toBeLessThan(methods.indexOf('list'));
    const readPath = (name: 'me' | 'list'): unknown =>
      Reflect.getMetadata(
        PATH_METADATA,
        Object.getOwnPropertyDescriptor(ProgramTeamsController.prototype, name)
          ?.value as object,
      );
    expect(readPath('me')).toBe('me');
    expect(readPath('list')).toBe('/');
  });

  it('list 는 service 결과를 StaffProgramTeamResponseDto 배열로 반환한다', async () => {
    const listForStaff = jest.fn().mockResolvedValue([
      {
        teamId: 'team-1',
        name: '오픈소스팀',
        memberCount: 1,
        members: [
          {
            userId: 'user-a',
            name: '가나다',
            nickname: 'login-a',
            isLeader: true,
          },
        ],
      },
    ]);
    const service: Pick<
      ProgramTeamsService,
      'create' | 'join' | 'getMe' | 'listForStaff' | 'getForStaff'
    > = {
      create: jest.fn(),
      join: jest.fn(),
      getMe: jest.fn(),
      listForStaff,
      getForStaff: jest.fn(),
    };
    const controller = new ProgramTeamsController(service);

    const response = await controller.list('program-1');

    expect(listForStaff).toHaveBeenCalledWith('program-1');
    expect(response).toEqual([
      {
        teamId: 'team-1',
        name: '오픈소스팀',
        memberCount: 1,
        members: [
          {
            userId: 'user-a',
            name: '가나다',
            nickname: 'login-a',
            isLeader: true,
          },
        ],
      },
    ]);
  });

  it('create 는 service 결과를 CreateTeamResponseDto 로 반환한다', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'team-1',
      name: '오픈소스팀',
      joinCode: 'ABCD1234XY',
      memberCount: 1,
    });
    const service: Pick<
      ProgramTeamsService,
      'create' | 'join' | 'getMe' | 'listForStaff' | 'getForStaff'
    > = {
      create,
      join: jest.fn(),
      getMe: jest.fn(),
      listForStaff: jest.fn(),
      getForStaff: jest.fn(),
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
    const service: Pick<
      ProgramTeamsService,
      'create' | 'join' | 'getMe' | 'listForStaff' | 'getForStaff'
    > = {
      create: jest.fn(),
      join,
      getMe: jest.fn(),
      listForStaff: jest.fn(),
      getForStaff: jest.fn(),
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
    const service: Pick<
      ProgramTeamsService,
      'create' | 'join' | 'getMe' | 'listForStaff' | 'getForStaff'
    > = {
      create: jest.fn(),
      join: jest.fn(),
      getMe,
      listForStaff: jest.fn(),
      getForStaff: jest.fn(),
    };
    const controller = new ProgramTeamsController(service);

    const response = await controller.me(
      { sessionGithubId: 4242n },
      'program-1',
    );

    expect(getMe).toHaveBeenCalledWith(4242n, 'program-1');
    expect(response.id).toBe('team-1');
  });

  it('detail(교직원 팀 상세) 에 SessionGuard·ProgramTeamsStaffGuard 를 적용한다', () => {
    expect(readGuards(ProgramTeamsController.prototype, 'detail')).toEqual([
      SessionGuard,
      ProgramTeamsStaffGuard,
    ]);
  });

  /**
   * 동적 세그먼트(`:teamId`)는 정적 형제(`join`, `me`, 빈 경로)보다 뒤에 선언해야
   * 한다 — 그렇지 않으면 `:teamId`가 그 정적 경로들을 가로챈다.
   */
  it('detail(:teamId) 을 join·me·list 보다 뒤에 선언한다', () => {
    const methods = Object.getOwnPropertyNames(
      ProgramTeamsController.prototype,
    );
    expect(methods.indexOf('detail')).toBeGreaterThan(methods.indexOf('join'));
    expect(methods.indexOf('detail')).toBeGreaterThan(methods.indexOf('me'));
    expect(methods.indexOf('detail')).toBeGreaterThan(methods.indexOf('list'));
    const path: unknown = Reflect.getMetadata(
      PATH_METADATA,
      Object.getOwnPropertyDescriptor(
        ProgramTeamsController.prototype,
        'detail',
      )?.value as object,
    );
    expect(path).toBe(':teamId');
  });

  it('detail 은 service 결과를 StaffTeamDetailResponseDto 로 반환한다', async () => {
    const getForStaff = jest.fn().mockResolvedValue({
      teamId: 'team-1',
      name: '오픈소스팀',
      memberCount: 1,
      members: [
        {
          userId: 'user-a',
          name: '가나다',
          nickname: 'login-a',
          isLeader: true,
        },
      ],
      application: null,
    });
    const service: Pick<
      ProgramTeamsService,
      'create' | 'join' | 'getMe' | 'listForStaff' | 'getForStaff'
    > = {
      create: jest.fn(),
      join: jest.fn(),
      getMe: jest.fn(),
      listForStaff: jest.fn(),
      getForStaff,
    };
    const controller = new ProgramTeamsController(service);

    const response = await controller.detail('program-1', 'team-1');

    expect(getForStaff).toHaveBeenCalledWith('program-1', 'team-1');
    expect(response).toEqual({
      teamId: 'team-1',
      name: '오픈소스팀',
      memberCount: 1,
      members: [
        {
          userId: 'user-a',
          name: '가나다',
          nickname: 'login-a',
          isLeader: true,
        },
      ],
      application: null,
    });
  });
});
