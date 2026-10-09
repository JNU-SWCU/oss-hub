import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus } from '@prisma/client';
import { AuthConfig } from '../../auth/auth.config';
import { SessionGuard } from '../../auth/controller/session.guard';
import { DomainException } from '../../common/error-code';
import {
  AUTH_ERROR_CODES,
  AuthErrorCode,
} from '../../auth/auth-error-code.enum';
import { ProblemDetailFilter } from '../../common/problem-detail.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { loadRuntimeConfig } from '../../runtime-config/runtime-config';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { ContributionInvariants } from '../contribution-invariants';
import { CollectionCutoverRepository } from '../repository/collection-cutover.repository';
import { CollectionIncrementalRepository } from '../repository/collection-incremental.repository';
import { CollectionSyncService } from '../service/collection-sync.service';
import { CollectionUserActivityService } from '../service/collection-user-activity.service';
import { CollectionAdminController } from './collection-admin.controller';

const roles = [
  ['ADMIN', true, true, AccountStatus.ACTIVE],
  ['STAFF', true, false, AccountStatus.ACTIVE],
  ['STUDENT', false, false, AccountStatus.ACTIVE],
  ['inactive STAFF', true, false, AccountStatus.DEACTIVATED],
  ['inactive ADMIN', true, true, AccountStatus.DEACTIVATED],
  ['missing user', false, false, null],
  ['anonymous', false, false, null],
] as const;

const routes = [
  ['get', 'invariants', 200],
  ['get', 'runs', 200],
  ['post', 'trigger', 202],
] as const;

describe('Collection admin authorization HTTP characterization', () => {
  let app: INestApplication;
  let baseUrl: string;
  let actor: (typeof roles)[number];
  const work = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CollectionAdminController],
      providers: [
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: () =>
                actor[3] === null
                  ? null
                  : {
                      hasStaffAccess: actor[1],
                      hasAdminAccess: actor[2],
                      accountStatus: actor[3],
                    },
            },
          },
        },
        {
          provide: AuthConfig,
          useValue: new AuthConfig(
            loadRuntimeConfig({
              SESSION_SECRET: Buffer.from(
                'synthetic-collection-admin-secret',
              ).toString('base64url'),
              FRONTEND_URL: 'http://localhost:3000',
              GITHUB_OAUTH_CLIENT_ID: 'synthetic-client',
              GITHUB_OAUTH_CLIENT_SECRET: 'synthetic-secret',
            }),
          ),
        },
        {
          provide: CollectionSyncService,
          useValue: { run: work, runExternal: work },
        },
        { provide: CollectionUserActivityService, useValue: { run: work } },
        {
          provide: ContributionInvariants,
          useValue: { check: () => ({ ok: true, results: [] }) },
        },
        {
          provide: CollectionCutoverRepository,
          useValue: { isQuiesced: () => false },
        },
        {
          provide: CollectionIncrementalRepository,
          useValue: { listSyncRuns: () => [] },
        },
        { provide: AuditLogService, useValue: { record: () => undefined } },
      ],
    })
      .overrideGuard(SessionGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => {
            getRequest: () => { sessionGithubId?: bigint };
          };
        }) => {
          if (actor[0] === 'anonymous')
            throw new DomainException(
              AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED],
            );
          context.switchToHttp().getRequest().sessionGithubId = 4242n;
          return true;
        },
      })
      .compile();
    work.mockResolvedValue({ status: 'COMPLETED' });
    app = module.createNestApplication();
    app.useGlobalFilters(new ProblemDetailFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(
    roles.flatMap((role) => routes.map((route) => [role, route] as const)),
  )(
    '%s / %s preserves status and complete body',
    async (role, [method, route, successStatus]) => {
      actor = role;
      const path = `/admin/collection/${route}`;
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { origin: 'http://localhost:3000', connection: 'close' },
      });
      const body: unknown = await response.json();
      if (role[0] === 'ADMIN') {
        expect(response.status).toBe(successStatus);
        if (route === 'trigger')
          expect(body).toEqual({
            runId: expect.any(String) as unknown,
            status: 'PENDING',
          });
        else
          expect(body).toEqual(
            route === 'runs' ? { runs: [] } : { ok: true, results: [] },
          );
        return;
      }
      const anonymous = role[0] === 'anonymous';
      expect(response.status).toBe(anonymous ? 401 : 403);
      expect(body).toEqual({
        type: 'about:blank',
        title: anonymous ? 'UNAUTHORIZED' : 'FORBIDDEN',
        status: anonymous ? 401 : 403,
        detail: anonymous
          ? AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED].message
          : '관리자 권한이 필요합니다.',
        instance: path,
        code: anonymous ? 'AUT_003' : 'COL_004',
      });
    },
  );
});
