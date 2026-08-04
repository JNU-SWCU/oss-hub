import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { ProgramActivityService } from './program-activity.service';
import { ProgramCreationService } from './program-creation.service';
import { ProgramViewerService } from './program-viewer.service';
import { ProgramsController } from './programs.controller';
import { ProgramsService } from './programs.service';

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

  it('인증 목록은 SessionGuard 뒤에서 viewer를 해석한다', async () => {
    const viewer = { githubId: 101n, userId: 'student-1', role: 'STUDENT' };
    viewers.fromGithubId.mockResolvedValue(viewer);
    programs.list.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      totalItems: 0,
      totalPages: 0,
    });

    await controller.viewerList(
      {
        page: 1,
        pageSize: 20,
        search: '',
        status: 'all',
        toQuery: () => ({
          page: 1,
          pageSize: 20,
          search: '',
          status: 'all' as const,
        }),
      },
      { sessionGithubId: 101n },
    );

    expect(viewers.fromGithubId).toHaveBeenCalledWith(101n);
    expect(programs.list).toHaveBeenCalledWith(expect.any(Object), viewer);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, controllerMethod('viewerList')),
    ).toContain(SessionGuard);
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
});
