import { randomBytes } from 'node:crypto';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../../auth/auth.config';
import { OriginGuard } from '../../auth/origin.guard';
import { sessionCookieName } from '../../auth/cookies';
import { issueSessionToken } from '../../auth/session-token';
import { SessionGuard } from '../../auth/session.guard';
import { ProgramActivityService } from '../service/program-activity.service';
import { ProgramCreationService } from '../service/program-creation.service';
import { ProgramLifecycleService } from '../service/program-lifecycle.service';
import { ProgramViewerService } from '../service/program-viewer.service';
import { ProgramsController } from './programs.controller';
import { ProgramsService } from '../service/programs.service';

const sessionSecret = new Uint8Array(randomBytes(32));
const authConfig = { sessionSecret, useSecureCookies: true } as AuthConfig;

function requestWithCookie(cookie?: string) {
  return { headers: { cookie } };
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

const publicDetail = {
  id: 'program-1',
  viewer: { role: null, applicationStatus: null },
  milestones: [],
};

describe('ProgramsController read boundaries', () => {
  const creation = { create: jest.fn() };
  const programs = {
    detail: jest.fn(),
    list: jest.fn(),
    statusCounts: jest.fn(),
  };
  const activity = { activity: jest.fn() };
  const viewers = { fromGithubId: jest.fn() };
  const lifecycle = { delete: jest.fn() };
  let controller: ProgramsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [ProgramsController],
      providers: [
        { provide: ProgramCreationService, useValue: creation },
        { provide: ProgramsService, useValue: programs },
        { provide: ProgramActivityService, useValue: activity },
        { provide: ProgramViewerService, useValue: viewers },
        { provide: AuthConfig, useValue: authConfig },
        { provide: ProgramLifecycleService, useValue: lifecycle },
      ],
    })
      .overrideGuard(OriginGuard)
      .useValue({ canActivate: jest.fn() })
      .overrideGuard(SessionGuard)
      .useValue({ canActivate: jest.fn() })
      .compile();
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

    await controller.list(query as never, requestWithCookie() as never);

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
    const token = await issueSessionToken(sessionSecret, 101n);
    const query = {
      toQuery: () => ({
        page: 1,
        pageSize: 20,
        search: '',
        status: 'all' as const,
      }),
    };

    await controller.list(
      query as never,
      requestWithCookie(`${sessionCookieName(true)}=${token}`) as never,
    );

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

    await controller.list(
      query as never,
      requestWithCookie(`${sessionCookieName(true)}=invalid-token`) as never,
    );

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

    await controller.list(query as never, requestWithCookie() as never);

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

  it('공개 상세는 익명 viewer만 전달하고 인증·private 조회를 시작하지 않는다', async () => {
    programs.detail.mockResolvedValue(publicDetail);

    await expect(controller.detail('program-1')).resolves.toBe(publicDetail);

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

  it('삭제는 세션·origin guard 뒤에 있고 세션 githubId·programId를 lifecycle 서비스에 그대로 넘긴다', async () => {
    lifecycle.delete.mockResolvedValue({ id: 'program-1', deleted: true });
    const request = { sessionGithubId: 101n };

    await expect(controller.delete('program-1', request)).resolves.toEqual({
      id: 'program-1',
      deleted: true,
    });

    expect(lifecycle.delete).toHaveBeenCalledWith(101n, 'program-1');
    expect(
      Reflect.getMetadata(GUARDS_METADATA, controllerMethod('delete')),
    ).toEqual([SessionGuard, OriginGuard]);
  });
});
