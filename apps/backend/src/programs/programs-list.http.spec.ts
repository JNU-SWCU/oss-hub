import { randomBytes } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthErrorCode } from '../auth/auth-error-code.enum';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { sessionCookieName } from '../auth/cookies';
import { issueSessionToken } from '../auth/session-token';
import { SessionGuard } from '../auth/session.guard';
import { DomainException } from '../common/error-code';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { ProgramActivityService } from './program-activity.service';
import { ProgramCreationService } from './program-creation.service';
import { ProgramViewerService } from './program-viewer.service';
import { ProgramsController } from './programs.controller';
import { ProgramsService } from './programs.service';

const secret = new Uint8Array(randomBytes(32));
const activeGithubId = 101n;
const staleGithubId = 202n;
const page = {
  items: [],
  page: 1,
  pageSize: 20,
  totalItems: 0,
  totalPages: 0,
};

const programs = {
  list: jest.fn().mockResolvedValue(page),
  detail: jest.fn(),
};
const viewers = {
  fromGithubId: jest.fn().mockResolvedValue({
    githubId: activeGithubId,
    userId: 'student-1',
    role: 'STUDENT',
  }),
};

let application: INestApplication | undefined;
let baseUrl = '';
let activeCookie = '';
let staleCookie = '';

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProgramsController],
    providers: [
      SessionGuard,
      {
        provide: AuthConfig,
        useValue: {
          sessionSecret: secret,
          allowedOrigin: 'http://frontend.test',
          useSecureCookies: false,
        },
      },
      {
        provide: AuthService,
        useValue: {
          getMe: jest.fn((githubId: bigint) => {
            if (githubId === staleGithubId) {
              throw new DomainException({
                code: AuthErrorCode.UNAUTHENTICATED,
                status: 401,
                message: '인증이 필요합니다.',
              });
            }
            return Promise.resolve({ id: 'student-1' });
          }),
        },
      },
      { provide: ProgramCreationService, useValue: { create: jest.fn() } },
      { provide: ProgramsService, useValue: programs },
      { provide: ProgramActivityService, useValue: { activity: jest.fn() } },
      { provide: ProgramViewerService, useValue: viewers },
    ],
  }).compile();

  application = moduleRef.createNestApplication();
  application.setGlobalPrefix('api/v1');
  application.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true }),
  );
  application.useGlobalFilters(new ProblemDetailFilter());
  await application.listen(0, '127.0.0.1');
  baseUrl = await application.getUrl();

  const activeToken = await issueSessionToken(secret, activeGithubId);
  const staleToken = await issueSessionToken(secret, staleGithubId);
  const cookieName = sessionCookieName(false);
  activeCookie = `${cookieName}=${activeToken}`;
  staleCookie = `${cookieName}=${staleToken}`;
});

afterAll(async () => {
  await application?.close();
});

beforeEach(() => {
  jest.clearAllMocks();
  programs.list.mockResolvedValue(page);
  viewers.fromGithubId.mockResolvedValue({
    githubId: activeGithubId,
    userId: 'student-1',
    role: 'STUDENT',
  });
});

describe('program list HTTP boundary', () => {
  it('공개 목록은 private viewer 조회 없이 응답한다', async () => {
    // Given / When
    const response = await fetch(`${baseUrl}/api/v1/programs`);

    // Then
    expect(response.status).toBe(200);
    expect(programs.list).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      search: '',
      status: 'all',
    });
    expect(viewers.fromGithubId).not.toHaveBeenCalled();
  });

  it.each([
    ['쿠키가 없는 요청', undefined],
    ['비활성화된 세션', staleCookie],
  ])('%s은 viewer 목록에서 401을 반환한다', async (_label, cookie) => {
    // Given / When
    const response = await fetch(`${baseUrl}/api/v1/programs/viewer`, {
      headers: cookie === undefined ? undefined : { cookie },
    });

    // Then
    expect(response.status).toBe(401);
    expect(programs.list).not.toHaveBeenCalled();
  });

  it('viewer 목록은 private no-store로 응답하고 정적 라우트로 해석된다', async () => {
    // Given / When
    const response = await fetch(`${baseUrl}/api/v1/programs/viewer`, {
      headers: { cookie: activeCookie },
    });

    // Then
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(viewers.fromGithubId).toHaveBeenCalledWith(activeGithubId);
    expect(programs.detail).not.toHaveBeenCalled();
  });
});
