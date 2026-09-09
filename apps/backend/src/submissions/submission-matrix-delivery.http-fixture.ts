import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { sessionCookieName } from '../auth/cookies';
import { issueSessionToken } from '../auth/session-token';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { SubmissionMatrixService } from './submission-matrix.service';
import { SubmissionMatrixController } from './submissions.controller';

const sessionSecret = new Uint8Array(32).fill(48);

export async function createMatrixDeliveryHttp(
  service: SubmissionMatrixService,
): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    controllers: [SubmissionMatrixController],
    providers: [
      SessionGuard,
      { provide: SubmissionMatrixService, useValue: service },
      { provide: AuthConfig, useValue: { sessionSecret } },
      {
        provide: AuthService,
        useValue: {
          getMe: jest.fn().mockResolvedValue({ sessionVersion: 0 }),
        },
      },
    ],
  }).compile();
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
  const token = await issueSessionToken(sessionSecret, githubId, 0);
  return { cookie: `${sessionCookieName(false)}=${token}` };
}
