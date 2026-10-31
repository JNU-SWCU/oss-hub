import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { ProblemDetailFilter } from '../platform/problem-detail.filter';
import { SubmissionMatrixService } from './submission-matrix.service';
import { ProgramSubmissionsController } from './program-submissions.controller';
import { AuthSessionService } from '../auth/auth-session.service';
import { GLOBAL_AUTHENTICATION_GUARD_PROVIDERS } from '../../test/global-authentication-guard.fixture';

const authSessionService = new AuthSessionService();

const sessionSecret = new Uint8Array(32).fill(48);

export async function createMatrixDeliveryHttp(
  service: SubmissionMatrixService,
): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    controllers: [ProgramSubmissionsController],
    providers: [
      AuthSessionService,
      ...GLOBAL_AUTHENTICATION_GUARD_PROVIDERS,
      { provide: SubmissionMatrixService, useValue: service },
      { provide: AuthConfig, useValue: { sessionSecret } },
      {
        provide: AuthService,
        useValue: {
          getMe: jest.fn().mockResolvedValue({ sessionVersion: 0 }),
        },
      },
    ],
  })
    .useMocker((token) => (token === Function ? undefined : {}))
    .compile();
  const application = module.createNestApplication();
  application.setGlobalPrefix('api/v1');
  application.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true }),
  );
  application.useGlobalFilters(new ProblemDetailFilter());
  await application.listen(0, '127.0.0.1');
  return application;
}

export async function matrixSessionHeaders(githubId: bigint) {
  const token = await authSessionService.issueSessionToken(
    sessionSecret,
    githubId,
    0,
  );
  return { cookie: `${authSessionService.sessionCookieName(false)}=${token}` };
}
