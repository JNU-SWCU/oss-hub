import {
  type ExecutionContext,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SessionGuard } from '../auth/session.guard';
import { OriginGuard } from '../auth/origin.guard';
import { ProblemDetailFilter } from '../platform/problem-detail.filter';
import { ProgramAuthoringController } from './program-authoring.controller';
import { ProgramAuthoringService } from './program-authoring.service';
import { ProgramAuthoringUploadService } from './program-authoring-upload.service';
import { ProgramAuthoringIdempotencyConflictError } from './program-authoring.policy';

let app: INestApplication;
let baseUrl: string;
const create = jest.fn();

describe('program authoring conflict HTTP contract', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProgramAuthoringController],
      providers: [
        {
          provide: ProgramAuthoringService,
          useValue: { create },
        },
        { provide: ProgramAuthoringUploadService, useValue: {} },
      ],
    })
      .useMocker((token) => (token === Function ? undefined : {}))
      .overrideGuard(SessionGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context
            .switchToHttp()
            .getRequest<{ sessionGithubId: bigint }>().sessionGithubId = 42n;
          return true;
        },
      })
      .overrideGuard(OriginGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    app.useGlobalFilters(new ProblemDetailFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    create.mockReset().mockImplementation(() => {
      throw new ProgramAuthoringIdempotencyConflictError(
        'synthetic-actor',
        'synthetic-key',
        'synthetic-existing-program',
      );
    });
  });

  const submit = (idempotencyKey: string) =>
    fetch(`${baseUrl}/api/v1/program-authoring/programs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({
        name: '합성 프로그램',
        organizer: '합성 조직',
        trackType: 'CURRICULAR',
        applicationStartAt: '2026-11-01T00:00:00.000Z',
        applicationEndAt: '2026-11-05T00:00:00.000Z',
        startAt: '2026-11-06T00:00:00.000Z',
        endAt: '2026-11-30T00:00:00.000Z',
        description: '합성 설명',
        teamMinSize: 1,
        teamMaxSize: 4,
        repositoryProvisioningEnabled: false,
        notifyOnDeadline: false,
        milestones: [
          {
            name: '합성 마일스톤',
            dueAt: '2026-11-20T00:00:00.000Z',
            documents: [],
          },
        ],
      }),
    });

  it('returns an actionable conflict without exposing actor ids or request keys', async () => {
    const response = await submit('synthetic-key');
    const problem: unknown = await response.json();

    expect(response.status).toBe(422);
    expect(problem).toMatchObject({
      code: 'PRG_017',
      status: 422,
      existingProgramId: 'synthetic-existing-program',
    });
    expect(problem).not.toHaveProperty('actorId');
    expect(problem).not.toHaveProperty('idempotencyKey');
  });

  it('keeps the legacy status-only client on the original key through repeated confirmation', async () => {
    create.mockImplementation((_actor: bigint, key: string) => {
      if (key === 'synthetic-key') {
        throw new ProgramAuthoringIdempotencyConflictError(
          'synthetic-actor',
          key,
          'synthetic-existing-program',
        );
      }
      return { id: 'duplicate-program' };
    });
    let idempotencyKey = 'synthetic-key';
    const responses: number[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await submit(idempotencyKey);
      responses.push(response.status);
      if (response.status === 409) idempotencyKey = 'rotated-key';
      await response.arrayBuffer();
    }

    expect({
      keys: create.mock.calls.map((call: unknown[]) => call[1]),
      responses,
    }).toEqual({
      keys: ['synthetic-key', 'synthetic-key'],
      responses: [422, 422],
    });
  });
});
