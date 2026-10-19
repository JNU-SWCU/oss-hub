import {
  type ExecutionContext,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SessionGuard } from '../../auth/controller/session.guard';
import { OriginGuard } from '../../auth/controller/origin.guard';
import { ProblemDetailFilter } from '../../common/controller/problem-detail.filter';
import { ProgramAuthoringController } from './program-authoring.controller';
import { ProgramAuthoringService } from '../service/program-authoring.service';
import { ProgramAuthoringUploadService } from '../service/program-authoring-upload.service';
import { ProgramAuthoringIdempotencyConflictError } from '../domain/program-authoring.types';

let app: INestApplication;
let baseUrl: string;

describe('program authoring conflict HTTP contract', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProgramAuthoringController],
      providers: [
        {
          provide: ProgramAuthoringService,
          useValue: {
            create: () => {
              throw new ProgramAuthoringIdempotencyConflictError(
                'synthetic-actor',
                'synthetic-key',
                'synthetic-existing-program',
              );
            },
          },
        },
        { provide: ProgramAuthoringUploadService, useValue: {} },
      ],
    })
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

  it('returns an actionable conflict without exposing actor ids or request keys', async () => {
    const response = await fetch(
      `${baseUrl}/api/v1/program-authoring/programs`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'synthetic-key',
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
      },
    );
    const problem: unknown = await response.json();

    expect(response.status).toBe(409);
    expect(problem).toMatchObject({
      code: 'PRG_017',
      existingProgramId: 'synthetic-existing-program',
    });
    expect(problem).not.toHaveProperty('actorId');
    expect(problem).not.toHaveProperty('idempotencyKey');
  });
});
