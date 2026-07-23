import { ExecutionContext, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { ProgramEditorController } from './program-editor.controller';
import { ProgramEditorRepository } from './program-editor.repository';
import { ProgramEditorService } from './program-editor.service';
import type {
  ProgramEditorRepositoryPort,
  ProgramEditorTransactionStore,
} from './program-editor.service';
import {
  editableProgram,
  updateInput,
} from '../../test/program-editor-service-fixtures';

let application: INestApplication | undefined;
let baseUrl = '';

const store: jest.Mocked<ProgramEditorTransactionStore> = {
  findUserAuthorityByGithubId: jest.fn(),
  findEditableProgramById: jest.fn(),
  findEditableProgramForUpdate: jest.fn(),
  updateProgram: jest.fn(),
  findProgramScheduleForMilestoneCreate: jest.fn(),
  createMilestone: jest.fn(),
  findMilestoneForUpdate: jest.fn(),
  updateMilestone: jest.fn(),
  findMilestoneForDelete: jest.fn(),
  deleteMilestone: jest.fn(),
};

const repository: ProgramEditorRepositoryPort = {
  withTransaction: (operation) => operation(store),
};

function sessionGuard(context: ExecutionContext): boolean {
  const request = context.switchToHttp().getRequest<{ sessionGithubId: bigint }>();
  request.sessionGithubId = 101n;
  return true;
}

async function readJson(response: Response): Promise<unknown> {
  return JSON.parse(await response.text()) as unknown;
}

async function patchProgram(body: object): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/programs/program-1`, {
    method: 'PATCH',
    headers: { connection: 'close', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProgramEditorController],
    providers: [
      ProgramEditorService,
      { provide: ProgramEditorRepository, useValue: repository },
    ],
  })
    .overrideGuard(SessionGuard)
    .useValue({ canActivate: sessionGuard })
    .overrideGuard(OriginGuard)
    .useValue({ canActivate: () => true })
    .compile();

  application = moduleRef.createNestApplication();
  application.setGlobalPrefix('api/v1');
  application.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true }),
  );
  application.useGlobalFilters(new ProblemDetailFilter());
  await application.listen(0, '127.0.0.1');
  baseUrl = await application.getUrl();
});

beforeEach(() => {
  jest.clearAllMocks();
  store.findUserAuthorityByGithubId.mockResolvedValue({
    role: Role.STAFF,
    accountStatus: AccountStatus.ACTIVE,
    roleRequests: [],
  });
  store.findEditableProgramForUpdate.mockResolvedValue(editableProgram);
});

afterAll(async () => {
  await application?.close();
});

it('returns field errors for an invalid application period through the API ProblemDetail contract', async () => {
  const response = await patchProgram({
    ...updateInput,
    applicationEndAt: '2026-07-31T00:00:00.000Z',
  });

  expect(response.status).toBe(422);
  expect(response.headers.get('content-type')).toContain(
    'application/problem+json',
  );
  expect(await readJson(response)).toMatchObject({
    type: 'about:blank',
    status: 422,
    instance: '/api/v1/programs/program-1',
    code: 'PRG_007',
    fieldErrors: [
      { field: 'applicationStartAt', code: 'INVALID_APPLICATION_PERIOD' },
      { field: 'applicationEndAt', code: 'INVALID_APPLICATION_PERIOD' },
    ],
  });
  expect(store.updateProgram.mock.calls).toHaveLength(0);
});

it('returns field errors for an invalid team range through the API ProblemDetail contract', async () => {
  const response = await patchProgram({
    ...updateInput,
    teamMinSize: null,
    teamMaxSize: null,
  });

  expect(response.status).toBe(400);
  expect(await readJson(response)).toMatchObject({
    status: 400,
    instance: '/api/v1/programs/program-1',
    code: 'PRG_001',
    fieldErrors: [
      { field: 'teamMinSize', code: 'INVALID_TEAM_RANGE' },
      { field: 'teamMaxSize', code: 'INVALID_TEAM_RANGE' },
    ],
  });
  expect(store.updateProgram.mock.calls).toHaveLength(0);
});
