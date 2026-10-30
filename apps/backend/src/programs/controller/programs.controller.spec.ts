import type { ProgramDetailResult } from '../domain/program-read.models';
import { ValidationPipe } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AccountStatus, MemberKind } from '@prisma/client';
import { Test } from '@nestjs/testing';
import {
  HTTP_AUTH_KINDS,
  type OptionalSessionRequest,
} from '../../auth/controller/http-auth';
import { OriginGuard } from '../../auth/controller/origin.guard';
import { SessionGuard } from '../../auth/controller/session.guard';
import { ProgramActivityService } from '../service/program-activity.service';
import { ProgramCreationService } from '../service/program-creation.service';
import { ProgramViewerService } from '../service/program-viewer.service';
import { ProgramsController } from './programs.controller';
import { ProgramsService } from '../service/programs.service';

const authenticatedAuth = {
  kind: HTTP_AUTH_KINDS.AUTHENTICATED,
  hasSessionCookie: true,
  principal: {
    id: 'student-1',
    githubId: 101n,
    nickname: 'synthetic-student',
    name: null,
    avatarUrl: null,
    accountStatus: AccountStatus.ACTIVE,
    sessionVersion: 0,
    memberKind: MemberKind.STUDENT,
    hasStaffAccess: false,
    hasAdminAccess: false,
    isProfileComplete: true,
  },
} satisfies OptionalSessionRequest['auth'];

function anonymousRequest(hasSessionCookie = false) {
  return {
    auth: { kind: HTTP_AUTH_KINDS.ANONYMOUS, hasSessionCookie },
  };
}

function authenticatedRequest() {
  return { auth: authenticatedAuth };
}

const controllerMethod = (name: keyof ProgramsController): object => {
  const method: unknown = Object.getOwnPropertyDescriptor(
    ProgramsController.prototype,
    name,
  )?.value;
  if (typeof method !== 'function') {
    throw new Error('Controller method metadata not found.');
  }
  return method;
};

const publicDetail: ProgramDetailResult = {
  id: 'program-1',
  coverImageUrl: null,
  name: 'Synthetic program',
  organizer: 'Synthetic organizer',
  trackType: null,
  applicationTemplateKey: 'basic',
  lifecycle: 'PUBLISHED',
  description: 'Synthetic description',
  repositoryProvisioningEnabled: false,
  applicationPeriod: {
    startsAt: new Date('2026-10-01T00:00:00.000Z'),
    endsAt: new Date('2026-10-10T00:00:00.000Z'),
  },
  operatingPeriod: {
    startsAt: new Date('2026-10-11T00:00:00.000Z'),
    endsAt: new Date('2026-11-01T00:00:00.000Z'),
  },
  viewer: { role: null, applicationStatus: null },
  milestones: [],
};

describe('ProgramsController read boundaries', () => {
  const creation = { create: jest.fn() };
  const programs = {
    detail: jest.fn(),
    list: jest.fn(),
    statusCounts: jest.fn(),
    endedYears: jest.fn(),
  };
  const activity = { activity: jest.fn() };
  const viewers = { fromGithubId: jest.fn() };
  let controller: ProgramsController;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [ProgramsController],
      providers: [
        { provide: ProgramCreationService, useValue: creation },
        { provide: ProgramsService, useValue: programs },
        { provide: ProgramActivityService, useValue: activity },
        { provide: ProgramViewerService, useValue: viewers },
      ],
    })
      .overrideGuard(OriginGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(SessionGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();
    moduleRef = module;
    controller = module.get(ProgramsController);
  });

  it('공개 목록은 익명·비활성 방문자에게 열려 있다', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, controllerMethod('list')),
    ).toBeUndefined();
  });

  it('세션 쿠키가 없으면 익명 뷰어로 목록을 조회한다', async () => {
    const page = {
      items: [],
      page: 1,
      pageSize: 20,
      totalItems: 0,
      totalPages: 0,
    };
    programs.list.mockResolvedValue(page);
    viewers.fromGithubId.mockResolvedValue({
      githubId: null,
      userId: null,
      role: null,
    });
    const query = {
      toQuery: () => ({
        page: 1,
        pageSize: 20,
        search: '',
        status: 'all' as const,
      }),
    };

    await controller.list(query as never, anonymousRequest() as never);

    expect(viewers.fromGithubId).toHaveBeenCalledWith(null);
    expect(programs.list).toHaveBeenCalledWith(
      { page: 1, pageSize: 20, search: '', status: 'all' },
      { githubId: null, userId: null, role: null },
    );
  });

  it('유효한 세션 쿠키가 있으면 해석된 뷰어로 목록을 개인화한다', async () => {
    const page = {
      items: [],
      page: 1,
      pageSize: 20,
      totalItems: 0,
      totalPages: 0,
    };
    programs.list.mockResolvedValue(page);
    const viewer = { githubId: 101n, userId: 'student-1', role: 'STUDENT' };
    viewers.fromGithubId.mockResolvedValue(viewer);
    const query = {
      toQuery: () => ({
        page: 1,
        pageSize: 20,
        search: '',
        status: 'all' as const,
      }),
    };

    await controller.list(query as never, authenticatedRequest() as never);

    expect(viewers.fromGithubId).toHaveBeenCalledWith(101n);
    expect(programs.list).toHaveBeenCalledWith(
      { page: 1, pageSize: 20, search: '', status: 'all' },
      viewer,
    );
  });

  it('형식이 잘못된 세션 쿠키는 익명 뷰어로 수렴한다(목록은 예외를 던지지 않는다)', async () => {
    const page = {
      items: [],
      page: 1,
      pageSize: 20,
      totalItems: 0,
      totalPages: 0,
    };
    programs.list.mockResolvedValue(page);
    viewers.fromGithubId.mockResolvedValue({
      githubId: null,
      userId: null,
      role: null,
    });
    const query = {
      toQuery: () => ({
        page: 1,
        pageSize: 20,
        search: '',
        status: 'all' as const,
      }),
    };

    await controller.list(query as never, anonymousRequest(true) as never);

    expect(viewers.fromGithubId).toHaveBeenCalledWith(null);
  });

  it('sort·direction·status 쿼리를 그대로 서비스에 넘긴다 (?status=recruiting&sort=name)', async () => {
    const page = {
      items: [],
      page: 1,
      pageSize: 20,
      totalItems: 0,
      totalPages: 0,
    };
    programs.list.mockResolvedValue(page);
    viewers.fromGithubId.mockResolvedValue({
      githubId: null,
      userId: null,
      role: null,
    });
    const query = {
      toQuery: () => ({
        page: 1,
        pageSize: 20,
        search: '',
        status: 'recruiting' as const,
        sort: 'name' as const,
        direction: 'asc' as const,
      }),
    };

    await controller.list(query as never, anonymousRequest() as never);

    expect(programs.list).toHaveBeenCalledWith(
      {
        page: 1,
        pageSize: 20,
        search: '',
        status: 'recruiting',
        sort: 'name',
        direction: 'asc',
      },
      { githubId: null, userId: null, role: null },
    );
  });

  it('status-counts 는 인증 없이 열려 있고 5키를 반환한다', async () => {
    const counts = {
      all: 15,
      recruiting: 3,
      in_progress: 3,
      upcoming: 0,
      ended: 9,
    };
    programs.statusCounts.mockResolvedValue(counts);

    await expect(controller.statusCounts()).resolves.toEqual(counts);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, controllerMethod('statusCounts')),
    ).toBeUndefined();
  });

  it('프로그램 생성은 공용 세션·origin guard 뒤에 있다', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, controllerMethod('create')),
    ).toEqual([SessionGuard, OriginGuard]);
  });

  it('returns ended years over HTTP before matching the detail route', async () => {
    const years = [2027, 2026, 2025];
    programs.endedYears.mockResolvedValue(years);
    const app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    try {
      const response = await fetch(
        `${await app.getUrl()}/programs/ended-years`,
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ years });
      expect(programs.detail).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects invalid list year with HTTP 400', async () => {
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.listen(0, '127.0.0.1');
    try {
      const response = await fetch(`${await app.getUrl()}/programs?year=2101`);

      expect(response.status).toBe(400);
      expect(programs.list).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('공개 상세는 익명 viewer만 전달하고 인증·private 조회를 시작하지 않는다', async () => {
    programs.detail.mockResolvedValue({
      ...publicDetail,
      internalKey: 'unpublished',
    });

    await expect(controller.detail('program-1')).resolves.toEqual({
      ...publicDetail,
      applicationPeriod: {
        startsAt: '2026-10-01T00:00:00.000Z',
        endsAt: '2026-10-10T00:00:00.000Z',
      },
      operatingPeriod: {
        startsAt: '2026-10-11T00:00:00.000Z',
        endsAt: '2026-11-01T00:00:00.000Z',
      },
    });

    expect(programs.detail).toHaveBeenCalledWith('program-1', {
      githubId: null,
      userId: null,
      role: null,
    });
    expect(viewers.fromGithubId).not.toHaveBeenCalled();
    expect(
      Reflect.getMetadata(GUARDS_METADATA, controllerMethod('detail')),
    ).toBeUndefined();
  });

  it('viewer HTTP 경계는 임의·중복 view 값을 400으로 거부한다', async () => {
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.listen(0, '127.0.0.1');
    try {
      for (const query of [
        'view=admin',
        'view=',
        'view=operations&view=admin',
      ]) {
        const response = await fetch(
          `${await app.getUrl()}/programs/program-1/viewer?${query}`,
        );
        expect(response.status).toBe(400);
      }
      expect(viewers.fromGithubId).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('프로그램 상세의 명시적 운영 전환만 viewer에 전달한다', async () => {
    viewers.fromGithubId.mockResolvedValue({
      githubId: 101n,
      userId: 'student-1',
      role: 'STAFF',
    });
    programs.detail.mockResolvedValue(publicDetail);
    await controller.viewerDetail(
      'program-1',
      { sessionGithubId: 101n },
      { view: 'operations' },
    );
    expect(viewers.fromGithubId).toHaveBeenCalledWith(101n, 'program-1', true);
  });

  it('viewer 상세와 활동 조회는 SessionGuard 뒤에서만 private viewer를 해석한다', async () => {
    const viewer = { githubId: 101n, userId: 'student-1', role: 'STUDENT' };
    viewers.fromGithubId.mockResolvedValue(viewer);
    programs.detail.mockResolvedValue(publicDetail);
    activity.activity.mockResolvedValue([]);
    const request = { sessionGithubId: 101n };

    await controller.viewerDetail('program-1', request);
    await controller.programActivity('program-1', request);

    expect(viewers.fromGithubId).toHaveBeenCalledTimes(2);
    expect(programs.detail).toHaveBeenCalledWith('program-1', viewer);
    expect(activity.activity).toHaveBeenCalledWith('program-1', viewer);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, controllerMethod('viewerDetail')),
    ).toContain(SessionGuard);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, controllerMethod('programActivity')),
    ).toContain(SessionGuard);
  });
});
