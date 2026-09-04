import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { OriginGuard } from '../../auth/origin.guard';
import { PrismaModule } from '../../prisma/prisma.module';
import { SessionGuard } from '../../auth/session.guard';
import { loadRuntimeConfig } from '../../runtime-config/runtime-config';
import {
  RUNTIME_CONFIG,
  RuntimeConfigModule,
} from '../../runtime-config/runtime-config.module';
import { ProgramEditorController } from './program-editor.controller';
import { ProgramEditorService } from '../service/program-editor.service';
import { ProgramLifecycleService } from '../service/program-lifecycle.service';
import { ProgramsModule } from '../programs.module';

const controllerMethod = (name: keyof ProgramEditorController): object => {
  const method: unknown = Object.getOwnPropertyDescriptor(
    ProgramEditorController.prototype,
    name,
  )?.value;
  if (typeof method !== 'function') {
    throw new Error('Controller method metadata not found.');
  }
  return method;
};

describe('ProgramEditorController boundaries', () => {
  const syntheticSessionSecret = Buffer.from(
    'synthetic-program-editor-session-secret',
  ).toString('base64url');
  const editor = {
    getProgram: jest.fn(),
    updateProgram: jest.fn(),
    createMilestone: jest.fn(),
  };
  const lifecycle = { update: jest.fn() };
  let controller: ProgramEditorController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [ProgramEditorController],
      providers: [
        { provide: ProgramEditorService, useValue: editor },
        { provide: ProgramLifecycleService, useValue: lifecycle },
      ],
    })
      .overrideGuard(OriginGuard)
      .useValue({ canActivate: jest.fn() })
      .overrideGuard(SessionGuard)
      .useValue({ canActivate: jest.fn() })
      .compile();
    controller = module.get(ProgramEditorController);
  });

  it('keeps edit reads behind SessionGuard without replacing public detail', async () => {
    const editable = {
      id: 'program-1',
      name: 'OSS',
      organizer: 'Center',
      trackType: 'EXTRACURRICULAR',
      applicationTemplateKey: 'oss-contest',
      applicationTemplateVersion: 1,
      applicationCount: 0,
      teamCount: 0,
      applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-08-10T00:00:00.000Z'),
      startAt: new Date('2026-08-16T00:00:00.000Z'),
      endAt: '2026-08-31T00:00:00.000Z',
      repositoryProvisioningEnabled: false,
      description: 'overview',
      milestones: [],
      teamMinSize: 2,
      teamMaxSize: 4,
    };
    editor.getProgram.mockResolvedValue(editable);
    const request = { sessionGithubId: 101n };

    const result = await controller.get(request, 'program-1');

    expect(result.id).toBe('program-1');
    expect(result);
    expect(result.endAt).toBe('2026-08-31T00:00:00.000Z');
    expect(editor.getProgram).toHaveBeenCalledWith(101n, 'program-1');
    expect(
      Reflect.getMetadata(GUARDS_METADATA, controllerMethod('get')),
    ).toContain(SessionGuard);
    expect(ProgramEditorController.prototype).not.toHaveProperty('detail');
  });

  it('wires editor service to the repository provider at module compile time', async () => {
    const module = await Test.createTestingModule({
      imports: [RuntimeConfigModule, PrismaModule, ProgramsModule],
    })
      .overrideProvider(RUNTIME_CONFIG)
      .useValue(
        loadRuntimeConfig({
          SESSION_SECRET: syntheticSessionSecret,
          FRONTEND_URL: 'http://localhost:3000',
          GITHUB_OAUTH_CLIENT_ID: 'synthetic-client-id',
          GITHUB_OAUTH_CLIENT_SECRET: 'synthetic-client-secret',
          GITHUB_OAUTH_CALLBACK_URL:
            'http://localhost:3000/api/v1/auth/github/callback',
          TEAM_JOIN_CODE_SECRET: 'synthetic-program-editor-secret',
          MAIL_MODE: 'dry-run',
        }),
      )
      .compile();

    expect(module.get(ProgramEditorService)).toBeInstanceOf(
      ProgramEditorService,
    );
    await module.close();
  });
  it('keeps mutations behind SessionGuard and OriginGuard', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, controllerMethod('update')),
    ).toEqual([SessionGuard, OriginGuard]);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, controllerMethod('createMilestone')),
    ).toEqual([SessionGuard, OriginGuard]);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, controllerMethod('updateLifecycle')),
    ).toEqual([SessionGuard, OriginGuard]);
  });
});
