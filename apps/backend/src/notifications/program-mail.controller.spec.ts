import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { AuthConfig } from '../platform/auth.config';
import { AuthSessionService } from '../platform/auth-session.service';
import { OriginGuard } from '../platform/origin.guard';
import { ProblemDetailFilter } from '../platform/problem-detail.filter';
import {
  GLOBAL_AUTHENTICATION_GUARD_PROVIDERS,
  sessionPrincipal,
} from '../../test/global-authentication-guard.fixture';
import { STATELESS_PROVIDERS } from '../../test/stateless-providers.fixture';
import { ProgramMailController } from './program-mail.controller';
import { ProgramMailService } from './program-mail.service';

const authSessionService = new AuthSessionService();
const sessionSecret = new Uint8Array(32).fill(9);
const recipients = jest.fn();
type SessionActor = Parameters<typeof sessionPrincipal>[0];
const findUnique = jest.fn<Promise<SessionActor>, []>();
let app: INestApplication;
let baseUrl = '';

async function sessionCookie(githubId: bigint): Promise<string> {
  const token = await authSessionService.issueSessionToken(
    sessionSecret,
    githubId,
    0,
  );
  return `${authSessionService.sessionCookieName(false)}=${token}`;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProgramMailController],
    providers: [
      ...STATELESS_PROVIDERS,
      AuthSessionService,
      ...GLOBAL_AUTHENTICATION_GUARD_PROVIDERS,
      OriginGuard,
      {
        provide: ProgramMailService,
        useValue: { recipients, preview: jest.fn(), send: jest.fn() },
      },
      {
        provide: AuthService,
        useValue: {
          getMe: async () => sessionPrincipal(await findUnique()),
        },
      },
      {
        provide: AuthConfig,
        useValue: {
          sessionSecret,
          allowedOrigin: 'http://frontend.test',
          useSecureCookies: false,
        },
      },
    ],
  })
    .overrideGuard(OriginGuard)
    .useValue({ canActivate: () => true })
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new ProblemDetailFilter());
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
});

beforeEach(() => {
  recipients.mockReset().mockResolvedValue({
    programId: 'program-1',
    programName: '합성 프로그램',
    teams: [],
  });
  findUnique.mockReset();
});

afterAll(async () => {
  await app.close();
});

it('rejects a student before exposing program recipients', async () => {
  findUnique.mockResolvedValue({
    id: 'student-1',
    hasStaffAccess: false,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
  });

  const response = await fetch(
    `${baseUrl}/api/v1/programs/program-1/mail/recipients`,
    { headers: { cookie: await sessionCookie(1001n), connection: 'close' } },
  );

  expect(response.status).toBe(403);
  expect(recipients).not.toHaveBeenCalled();
});

it('allows active staff to read program recipients', async () => {
  findUnique.mockResolvedValue({
    id: 'staff-1',
    hasStaffAccess: true,
    hasAdminAccess: false,
    accountStatus: AccountStatus.ACTIVE,
  });

  const response = await fetch(
    `${baseUrl}/api/v1/programs/program-1/mail/recipients`,
    { headers: { cookie: await sessionCookie(1002n), connection: 'close' } },
  );

  expect(response.status).toBe(200);
  expect(recipients).toHaveBeenCalledWith('program-1');
});
