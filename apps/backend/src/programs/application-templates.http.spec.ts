import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../auth/auth.config';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { DomainException } from '../common/error-code';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { ApplicationTemplatesController } from './controller/application-templates.controller';
import { PROGRAM_ERROR_CODES } from './program-error-code';
import { ProgramActivityService } from './service/program-activity.service';
import { ProgramCreationService } from './service/program-creation.service';
import { ProgramViewerService } from './service/program-viewer.service';
import { ProgramsController } from './controller/programs.controller';
import { ProgramsService } from './service/programs.service';
import { V1_APPLICATION_FIELDS } from './program-template.registry';

let application: INestApplication | undefined;
let baseUrl = '';

async function readJson(response: Response): Promise<unknown> {
  return JSON.parse(await response.text()) as unknown;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ApplicationTemplatesController, ProgramsController],
    providers: [
      {
        provide: ProgramCreationService,
        useValue: { create: jest.fn() },
      },
      {
        provide: ProgramsService,
        useValue: {
          list: jest.fn(),
          detail: jest.fn((programId: string) =>
            Promise.reject(
              new DomainException({
                ...PROGRAM_ERROR_CODES.NOT_FOUND,
                message: `프로그램을 찾을 수 없습니다. (${programId})`,
              }),
            ),
          ),
        },
      },
      {
        provide: ProgramActivityService,
        useValue: { activity: jest.fn() },
      },
      {
        provide: ProgramViewerService,
        useValue: { fromGithubId: jest.fn() },
      },
      {
        provide: AuthConfig,
        useValue: { sessionSecret: new Uint8Array(32), useSecureCookies: true },
      },
    ],
  })
    .overrideGuard(SessionGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(OriginGuard)
    .useValue({ canActivate: () => true })
    .compile();

  application = moduleRef.createNestApplication();
  application.setGlobalPrefix('api/v1');
  application.useGlobalFilters(new ProblemDetailFilter());
  await application.listen(0, '127.0.0.1');
  baseUrl = await application.getUrl();
});

afterAll(async () => {
  await application?.close();
});

describe('GET /api/v1/programs/application-templates', () => {
  it('application-templates를 program :id로 캡처하지 않고 템플릿 목록을 반환한다', async () => {
    const response = await fetch(
      `${baseUrl}/api/v1/programs/application-templates`,
      { headers: { connection: 'close' } },
    );
    const body = (await readJson(response)) as {
      items: Array<{
        key: string;
        version: number;
        name: string;
        participation: string;
        fields: Array<{
          key: string;
          type: string;
          label: string;
          required: boolean;
        }>;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(7);
    expect(body.items.map((item) => item.key).sort()).toEqual(
      [
        'basic',
        'capstone',
        'corporate-internship',
        'global-makerthon',
        'oss-contest',
        'sw-convergence',
        'sw-value-spread',
      ].sort(),
    );
    for (const item of body.items) {
      expect(item.version).toBe(1);
      expect(item.fields).toEqual([...V1_APPLICATION_FIELDS]);
    }
    expect(body.items.find((item) => item.key === 'basic')?.name).toBe(
      '기본 신청서',
    );
  });

  it('실제 없는 program id 상세는 404이며 application-templates 경로와 충돌하지 않는다', async () => {
    const missing = await fetch(
      `${baseUrl}/api/v1/programs/not-a-real-program`,
      { headers: { connection: 'close' } },
    );
    expect(missing.status).toBe(404);

    const templates = await fetch(
      `${baseUrl}/api/v1/programs/application-templates`,
      { headers: { connection: 'close' } },
    );
    expect(templates.status).toBe(200);
  });
});
