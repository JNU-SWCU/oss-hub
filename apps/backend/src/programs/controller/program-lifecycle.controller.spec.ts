import { Test, type TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { OriginGuard } from '../../auth/controller/origin.guard';
import { SessionGuard } from '../../auth/controller/session.guard';
import { ProgramLifecycleService } from '../service/program-lifecycle.service';
import { ProgramLifecycleController } from './program-lifecycle.controller';

const controllerMethod = (name: keyof ProgramLifecycleController): object => {
  const method: unknown = Object.getOwnPropertyDescriptor(
    ProgramLifecycleController.prototype,
    name,
  )?.value;
  if (typeof method !== 'function')
    throw new Error('Controller method metadata not found.');
  return method;
};

describe('ProgramLifecycleController boundaries', () => {
  const lifecycle = { delete: jest.fn(), purge: jest.fn() };
  let controller: ProgramLifecycleController;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    jest.clearAllMocks();
    moduleRef = await Test.createTestingModule({
      controllers: [ProgramLifecycleController],
      providers: [{ provide: ProgramLifecycleService, useValue: lifecycle }],
    })
      .overrideGuard(SessionGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(OriginGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(ProgramLifecycleController);
  });

  afterEach(async () => {
    await moduleRef.close();
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

  it('purge는 세션·origin guard 뒤에 있고 세션 githubId·programId·expectedScope를 lifecycle 서비스에 그대로 넘긴다', async () => {
    const purgeResult = {
      id: 'program-1',
      deleted: true,
      deletedCounts: { applications: 2, teams: 1 },
    };
    lifecycle.purge.mockResolvedValue(purgeResult);
    const request = { sessionGithubId: 101n };
    const expectedScope = {
      applications: 2,
      teams: 1,
      boardPosts: 0,
      submissions: 0,
      submissionEvents: 0,
      scopeFingerprint: '0123456789abcdef0123456789abcdef',
    };

    await expect(
      controller.purge('program-1', { expectedScope }, request),
    ).resolves.toEqual(purgeResult);

    expect(lifecycle.purge).toHaveBeenCalledWith(
      101n,
      'program-1',
      expectedScope,
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, controllerMethod('purge')),
    ).toEqual([SessionGuard, OriginGuard]);
  });
});
