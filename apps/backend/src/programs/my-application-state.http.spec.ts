import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { ApplicationPreparationsController } from './application-preparations.controller';
import { ApplicationPreparationsService } from './application-preparations.service';
import { StudentApplicationManagementService } from './student-application-management.service';
import { StudentApplicationsController } from './student-applications.controller';
import { AuthSessionService } from '../auth/auth-session.service';
import { STATELESS_PROVIDERS } from '../../test/stateless-providers.fixture';

const authSessionService = new AuthSessionService();

const secret = new Uint8Array(32).fill(9);
const origin = 'http://frontend.test';
const APPLICATION = {
  id: 'application-1',
  programId: 'program-1',
  status: 'REJECTED',
  teamId: null,
  answers: { applicantName: '합성 학생', title: '제목' },
  submittedAt: new Date('2026-07-10T00:00:00.000Z'),
  updatedAt: new Date('2026-07-11T00:00:00.000Z'),
  isRepositoryPublicationPlanned: false,
  rejectionReason: '합성 반려 사유',
  isManager: true,
  canManage: false,
};
const PREPARATION = {
  id: 'team-1',
  name: '합성 팀',
  memberCount: 1,
  minMembers: 1,
  maxMembers: 4,
  isLeader: true,
  members: [{ userId: 'user-1', nickname: 'octo', name: null, isLeader: true }],
};
const getMine = jest.fn();
const getPreparation = jest.fn();
let app: INestApplication;
let baseUrl: string;
let cookie: string;

beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [
      StudentApplicationsController,
      ApplicationPreparationsController,
    ],
    providers: [
      ...STATELESS_PROVIDERS,
      AuthSessionService,
      {
        provide: StudentApplicationManagementService,
        useValue: { getMine },
      },
      {
        provide: ApplicationPreparationsService,
        useValue: { get: getPreparation },
      },
      SessionGuard,
      OriginGuard,
      {
        provide: AuthService,
        useValue: {
          getMe: jest
            .fn()
            .mockResolvedValue({ id: 'student', sessionVersion: 0 }),
        },
      },
      {
        provide: AuthConfig,
        useValue: {
          sessionSecret: secret,
          allowedOrigin: origin,
          useSecureCookies: false,
        },
      },
    ],
  }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
  cookie = `${authSessionService.sessionCookieName(false)}=${await authSessionService.issueSessionToken(secret, 1133n, 0)}`;
});
afterAll(async () => {
  await app?.close();
});

async function getJson(path: string): Promise<{
  readonly status: number;
  readonly text: string;
  readonly cacheControl: string | null;
}> {
  const response = await fetch(`${baseUrl}/api/v1/${path}`, {
    headers: { connection: 'close', cookie },
  });
  return {
    status: response.status,
    text: await response.text(),
    cacheControl: response.headers.get('cache-control'),
  };
}

describe('GET programs/:programId/applications/me', () => {
  const path = 'programs/program-1/applications/me';

  it('신청이 없으면 빈 본문 대신 NONE 상태 JSON을 보낸다', async () => {
    getMine.mockResolvedValueOnce(null);

    const response = await getJson(path);

    expect(response.status).toBe(200);
    expect(response.text).toBe('{"status":"NONE"}');
    expect(response.cacheControl).toBe('private, no-store');
  });

  it('신청이 있으면 신청 상태와 기존 본문을 application 아래에 보낸다', async () => {
    getMine.mockResolvedValueOnce(APPLICATION);

    const response = await getJson(path);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toEqual({
      status: 'REJECTED',
      application: {
        ...APPLICATION,
        submittedAt: '2026-07-10T00:00:00.000Z',
        updatedAt: '2026-07-11T00:00:00.000Z',
        canEdit: false,
        canCancel: false,
      },
    });
    expect(response.cacheControl).toBe('private, no-store');
  });
});

describe('GET application-preparations/programs/:programId/me', () => {
  const path = 'application-preparations/programs/program-1/me';
  const body = {
    ...PREPARATION,
    preparation: true,
    hasApplication: false,
    canInvite: true,
    canRemoveMembers: true,
    canLeave: false,
  };

  it('지원 준비가 없으면 빈 본문 대신 NONE 소속 JSON을 보낸다', async () => {
    getPreparation.mockResolvedValueOnce(null);

    const response = await getJson(path);

    expect(response.status).toBe(200);
    expect(response.text).toBe('{"membership":"NONE"}');
  });

  it('팀장이면 LEADER 소속과 기존 본문을 preparation 아래에 보낸다', async () => {
    getPreparation.mockResolvedValueOnce(PREPARATION);

    const response = await getJson(path);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toEqual({
      membership: 'LEADER',
      preparation: body,
    });
  });

  it('팀원이면 MEMBER 소속으로 보낸다', async () => {
    getPreparation.mockResolvedValueOnce({ ...PREPARATION, isLeader: false });

    const response = await getJson(path);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toMatchObject({
      membership: 'MEMBER',
      preparation: { id: 'team-1', isLeader: false, canLeave: true },
    });
  });
});
