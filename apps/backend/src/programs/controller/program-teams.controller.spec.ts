import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { OriginGuard } from '../../auth/origin.guard';
import { SessionGuard } from '../../auth/session.guard';
import { CreateTeamRequestDto } from '../dto/create-team-request.dto';
import { ProgramTeamsController } from './program-teams.controller';
import { ProgramTeamsStaffGuard } from '../program-teams-staff.guard';

type ControllerMethodName =
  'create' | 'me' | 'leave' | 'removeMember' | 'list' | 'detail';

/** controller 가 실제로 주입받는 최소 능력 집합 — 계약이 바뀌면 여기서 먼저 깨진다. */
type ControllerService = ConstructorParameters<
  typeof ProgramTeamsController
>[0];

function methodOf(name: ControllerMethodName): object | undefined {
  const value: unknown = Object.getOwnPropertyDescriptor(
    ProgramTeamsController.prototype,
    name,
  )?.value;
  return typeof value === 'function' ? value : undefined;
}

function readGuards(name: ControllerMethodName): unknown[] {
  const method = methodOf(name);
  if (!method) return [];
  const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, method);
  return Array.isArray(guards) ? guards : [];
}

function readPath(name: ControllerMethodName): unknown {
  const method = methodOf(name);
  return method ? Reflect.getMetadata(PATH_METADATA, method) : undefined;
}

function declarationOrder(name: ControllerMethodName): number {
  return Object.getOwnPropertyNames(ProgramTeamsController.prototype).indexOf(
    name,
  );
}

function serviceStub(
  overrides: Partial<ControllerService> = {},
): ControllerService {
  return {
    create: jest.fn(),
    getMe: jest.fn(),
    leave: jest.fn(),
    removeMember: jest.fn(),
    listForStaff: jest.fn(),
    getForStaff: jest.fn(),
    ...overrides,
  };
}

describe('ProgramTeamsController', () => {
  it('create 에 SessionGuard·OriginGuard 를 적용한다', () => {
    expect(readGuards('create')).toEqual([SessionGuard, OriginGuard]);
  });

  /**
   * 팀 합류는 초대 수락 단독 경로다 — 참여코드로 합류하던 `POST teams/join` 은
   * 초대 전용 규칙을 우회하므로 handler 자체를 지우고, alias·410 대체 route 도
   * 두지 않는다. 등록된 handler 가 없으면 Nest 가 표준 404 를 돌려준다.
   */
  it('join handler 를 등록하지 않는다 — 초대 수락만 팀에 들어오는 경로다', () => {
    const prototype: object = ProgramTeamsController.prototype;
    expect(Object.getOwnPropertyNames(prototype)).not.toContain('join');

    const registeredPaths = Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== 'constructor')
      .map((name): unknown =>
        Reflect.getMetadata(
          PATH_METADATA,
          Object.getOwnPropertyDescriptor(prototype, name)?.value as object,
        ),
      );
    expect(registeredPaths).not.toContain('join');
  });

  it('me 에 SessionGuard 를 적용한다', () => {
    expect(readGuards('me')).toEqual([SessionGuard]);
  });

  it('list(교직원 팀 목록) 에 SessionGuard·ProgramTeamsStaffGuard 를 적용한다', () => {
    expect(readGuards('list')).toEqual([SessionGuard, ProgramTeamsStaffGuard]);
  });

  /**
   * 정적 형제 우선 규칙(`programs.controller.ts`) — `GET me` 가 `GET ''` 보다 먼저
   * 선언돼 있어야 한다. Nest 는 선언 순서대로 라우트를 등록한다.
   */
  it('GET me 를 GET (목록) 보다 먼저 선언한다', () => {
    expect(declarationOrder('me')).toBeLessThan(declarationOrder('list'));
    expect(readPath('me')).toBe('me');
    expect(readPath('list')).toBe('/');
  });

  describe('DELETE me/members/:userId (팀장의 팀원 제외)', () => {
    it('DELETE 메서드·정적 me 하위 경로·204 로 등록한다', () => {
      const method = methodOf('removeMember');
      expect(readPath('removeMember')).toBe('me/members/:userId');
      expect(Reflect.getMetadata(METHOD_METADATA, method as object)).toBe(
        RequestMethod.DELETE,
      );
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, method as object)).toBe(
        204,
      );
    });

    it('SessionGuard·OriginGuard 를 적용한다 — 세션과 동일 출처 둘 다 필요하다', () => {
      expect(readGuards('removeMember')).toEqual([SessionGuard, OriginGuard]);
    });

    /**
     * `me/members/:userId` 는 정적 `me` 아래라, 교직원 동적 경로 `:teamId` 보다
     * 먼저 선언돼야 `:teamId` 가 `me` 를 가로채지 않는다.
     */
    it('교직원 동적 경로(:teamId) 보다 먼저 선언한다', () => {
      expect(declarationOrder('removeMember')).toBeLessThan(
        declarationOrder('detail'),
      );
      expect(declarationOrder('removeMember')).toBeLessThan(
        declarationOrder('list'),
      );
    });

    it('행위자 세션·프로그램·대상 팀원을 그대로 service 로 넘기고 본문 없이 끝낸다', async () => {
      const removeMember = jest.fn().mockResolvedValue(undefined);
      const controller = new ProgramTeamsController(
        serviceStub({ removeMember }),
      );

      const response = await controller.removeMember(
        { sessionGithubId: 4242n },
        'program-1',
        'user-b',
      );

      expect(removeMember).toHaveBeenCalledWith(4242n, 'program-1', 'user-b');
      expect(response).toBeUndefined();
    });

    it('service 오류를 그대로 전파한다 — controller 가 권한을 다시 판정하지 않는다', async () => {
      const failure = new Error('LEADER_ONLY');
      const removeMember = jest.fn().mockRejectedValue(failure);
      const controller = new ProgramTeamsController(
        serviceStub({ removeMember }),
      );

      await expect(
        controller.removeMember({ sessionGithubId: 1n }, 'program-1', 'user-b'),
      ).rejects.toBe(failure);
    });
  });

  describe('DELETE me (본인 탈퇴)', () => {
    it('SessionGuard·OriginGuard 와 204 로 등록한다', () => {
      expect(readGuards('leave')).toEqual([SessionGuard, OriginGuard]);
      expect(readPath('leave')).toBe('me');
      expect(
        Reflect.getMetadata(HTTP_CODE_METADATA, methodOf('leave') as object),
      ).toBe(204);
    });

    it('세션·프로그램을 service.leave 로 넘긴다', async () => {
      const leave = jest.fn().mockResolvedValue(undefined);
      const controller = new ProgramTeamsController(serviceStub({ leave }));

      const response = await controller.leave(
        { sessionGithubId: 7n },
        'program-1',
      );

      expect(leave).toHaveBeenCalledWith(7n, 'program-1');
      expect(response).toBeUndefined();
    });
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
    const controller = new ProgramTeamsController(
      serviceStub({ listForStaff }),
    );

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
    const controller = new ProgramTeamsController(serviceStub({ create }));
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

  describe('GET me 응답 계약', () => {
    const view = {
      id: 'team-1',
      name: '오픈소스팀',
      memberCount: 2,
      minMembers: 2,
      maxMembers: 4,
      hasApplication: true,
      canInvite: true,
      canRemoveMembers: true,
      canLeave: true,
      isLeader: true,
      members: [
        {
          userId: 'user-a',
          nickname: 'login-a',
          name: '가나다',
          isLeader: true,
        },
      ],
    };

    it('service.getMe 결과의 허용 필드만 그대로 돌려준다', async () => {
      const getMe = jest.fn().mockResolvedValue(view);
      const controller = new ProgramTeamsController(serviceStub({ getMe }));

      const response = await controller.me(
        { sessionGithubId: 4242n },
        'program-1',
      );

      expect(getMe).toHaveBeenCalledWith(4242n, 'program-1');
      expect({ ...response }).toEqual(view);
      expect(Object.keys({ ...response }).sort()).toEqual([
        'canInvite',
        'canLeave',
        'canRemoveMembers',
        'hasApplication',
        'id',
        'isLeader',
        'maxMembers',
        'memberCount',
        'members',
        'minMembers',
        'name',
      ]);
    });

    /**
     * 폐기된 `locked` 는 응답에서 사라졌다 — 프런트가 능력 플래그로만 판단한다.
     * service 가 실수로 남긴 여분 필드도 DTO 명시 매핑이 걸러낸다.
     */
    it('locked 등 view 밖의 여분 키를 응답에 싣지 않는다', async () => {
      const getMe = jest
        .fn()
        .mockResolvedValue({ ...view, locked: true, currentUserId: 'user-a' });
      const controller = new ProgramTeamsController(serviceStub({ getMe }));

      const response = await controller.me(
        { sessionGithubId: 4242n },
        'program-1',
      );

      const keys = Object.keys({ ...response });
      expect(keys).not.toContain('locked');
      expect(keys).not.toContain('currentUserId');
    });
  });

  it('detail(교직원 팀 상세) 에 SessionGuard·ProgramTeamsStaffGuard 를 적용한다', () => {
    expect(readGuards('detail')).toEqual([
      SessionGuard,
      ProgramTeamsStaffGuard,
    ]);
  });

  /**
   * 동적 세그먼트(`:teamId`)는 정적 형제(`me`, 빈 경로)보다 뒤에 선언해야
   * 한다 — 그렇지 않으면 `:teamId`가 그 정적 경로들을 가로챈다.
   */
  it('detail(:teamId) 을 me·list 보다 뒤에 선언한다', () => {
    expect(declarationOrder('detail')).toBeGreaterThan(declarationOrder('me'));
    expect(declarationOrder('detail')).toBeGreaterThan(
      declarationOrder('list'),
    );
    expect(readPath('detail')).toBe(':teamId');
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
    const controller = new ProgramTeamsController(serviceStub({ getForStaff }));

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
