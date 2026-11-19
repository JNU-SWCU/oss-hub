import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../platform/auth.config';
import { AuthService } from '../auth/auth.service';
import { configureHttpApp } from '../configure-http-app';
import { SubmissionMatrixService } from './submission-matrix.service';
import { ProgramSubmissionsController } from './submissions.controller';
import { AuthSessionService } from '../platform/auth-session.service';
import {
  GLOBAL_AUTHENTICATION_GUARD_PROVIDERS,
  databaseSessionPrincipal,
} from '../../test/global-authentication-guard.fixture';

const authSessionService = new AuthSessionService();

const sessionSecret = new Uint8Array(32).fill(48);

export async function createMatrixDeliveryHttp(
  service: SubmissionMatrixService,
  prisma: Parameters<typeof databaseSessionPrincipal>[0],
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
          getMe: (githubId: bigint) =>
            databaseSessionPrincipal(prisma, githubId),
        },
      },
    ],
  })
    .useMocker((token) => (token === Function ? undefined : {}))
    .compile();
  const application = module.createNestApplication();
  configureHttpApp(application);
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
