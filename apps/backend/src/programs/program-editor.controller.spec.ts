import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { OriginGuard } from '../auth/origin.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { SessionGuard } from '../auth/session.guard';
import { ProgramEditorController } from './program-editor.controller';
import { ProgramEditorService } from './program-editor.service';
import { ProgramsModule } from './programs.module';

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
  const editor = {
    getProgram: jest.fn(),
    updateProgram: jest.fn(),
    createMilestone: jest.fn(),
  };
  let controller: ProgramEditorController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [ProgramEditorController],
      providers: [{ provide: ProgramEditorService, useValue: editor }],
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
      category: 'OSS_CONTEST',
      applicationTemplateKey: 'oss-contest',
      applicationTemplateVersion: 1,
      applicationCount: 0,
      applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-08-10T00:00:00.000Z'),
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
    expect(editor.getProgram).toHaveBeenCalledWith(101n, 'program-1');
    expect(
      Reflect.getMetadata(GUARDS_METADATA, controllerMethod('get')),
    ).toContain(SessionGuard);
    expect(ProgramEditorController.prototype).not.toHaveProperty('detail');
  });

  it('wires editor service to the repository provider at module compile time', async () => {
    const module = await Test.createTestingModule({
      imports: [PrismaModule, ProgramsModule],
    }).compile();

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
  });
});
