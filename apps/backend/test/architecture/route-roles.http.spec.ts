import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditLogController } from '../../src/admin/audit-log.controller';
import { CollectionAdminController } from '../../src/admin/collection-admin.controller';
import { SystemStatusController } from '../../src/admin/system-status.controller';
import { configureHttpApp } from '../../src/configure-http-app';
import { DeadlineDigestController } from '../../src/notifications/deadline-digest.controller';
import { AuthConfig } from '../../src/platform/auth.config';
import {
  ApplicationsController,
  ProgramApplicationsController,
  TeamsController,
} from '../../src/programs/teams.controller';
import {
  RequirementsController,
  ProgramDocumentArchivesController,
  ProgramDocumentChangeRequestsController,
} from '../../src/programs/requirements.controller';
import { ProgramAuthoringController } from '../../src/programs/program-authoring.controller';
import {
  ProgramSubmissionsController,
  SubmissionRepositoryPublishingController,
  SubmissionsController,
} from '../../src/programs/submissions.controller';
import { ProgramsController } from '../../src/programs/programs.controller';
import { StaffDashboardController } from '../../src/staff/staff-dashboard.controller';
import { protectedRouteGuardStub } from '../global-authentication-guard.fixture';

const allowedOrigin = 'http://frontend.test';

const student = { id: 'student', hasStaffAccess: false, hasAdminAccess: false };
const staff = { id: 'staff', hasStaffAccess: true, hasAdminAccess: false };

const cases = [
  ['GET', '/milestones/m/documents/collection', student, 403, 'MSD_001'],
  ['GET', '/programs/p/documents/collection/archive', student, 403, 'MSD_001'],
  ['POST', '/programs/p/documents/change-requests', student, 403, 'MSD_001'],
  ['GET', '/programs/p/teams?view=team-management', student, 403, 'APP_018'],
  ['GET', '/programs/p/teams', student, 403, 'APP_018'],
  ['GET', '/teams/a', student, 403, 'APP_018'],
  ['PATCH', '/teams/a', student, 403, 'APP_004'],
  ['GET', '/submissions/s/review-context', student, 403, 'SUB_002'],
  ['POST', '/repositories/r/publish', student, 403, 'SUB_002'],
  ['GET', '/programs/p/submissions/matrix', student, 403, 'SUB_015'],
  ['GET', '/dashboard/staff/summary', student, 403, 'APP_018'],
  ['POST', '/programs/p/deadline-digest/preview', student, 403, 'NOT_001'],
  ['POST', '/programs', student, 403, 'PRG_002'],
  ['DELETE', '/programs/p', student, 403, 'PRG_011'],
  ['POST', '/admin/collection/trigger', staff, 403, 'COL_004'],
  ['GET', '/audit-logs', staff, 403, 'AUD_001'],
] as const;

const unavailable = [
  ['GET', '/system-status', staff, 403],
  ['GET', '/program-authoring/upload-policy', student, 409],
] as const;

describe('Route roles over HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  let principal: object = student;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        AuditLogController,
        CollectionAdminController,
        SystemStatusController,
        DeadlineDigestController,
        ApplicationsController,
        RequirementsController,
        ProgramApplicationsController,
        ProgramAuthoringController,
        ProgramDocumentArchivesController,
        ProgramDocumentChangeRequestsController,
        ProgramSubmissionsController,
        TeamsController,
        ProgramsController,
        SubmissionRepositoryPublishingController,
        SubmissionsController,
        StaffDashboardController,
      ],
      providers: [
        protectedRouteGuardStub({
          canActivate: (context: ExecutionContext) => {
            Object.assign(context.switchToHttp().getRequest<object>(), {
              principal,
            });
            return true;
          },
        }),
        { provide: AuthConfig, useValue: { allowedOrigin } },
      ],
    })
      .useMocker(() => ({}))
      .compile();
    app = module.createNestApplication();
    configureHttpApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  const send = (method: string, path: string, actor: object) => {
    principal = actor;
    return fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers: { origin: allowedOrigin, connection: 'close' },
    });
  };

  it.each(cases)(
    '%s %s denies the wrong role with its module error',
    async (method, path, actor, status, code) => {
      const response = await send(method, path, actor);

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ status, code });
    },
  );

  it.each(unavailable)(
    '%s %s denies the wrong role with its legacy status',
    async (method, path, actor, status) => {
      const response = await send(method, path, actor);

      expect(response.status).toBe(status);
      await response.text();
    },
  );
});
