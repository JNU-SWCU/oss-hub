import { ProgramLifecycle, ProgramTrackType } from '@prisma/client';
import type { ApplicationsRepository } from '../repository/applications.repository';
import type { StaffDashboardSummary } from '../domain/application-records';
import { ApplicationsErrorCode } from '../domain/applications-error-code.enum';
import { ApplicationsService } from './applications.service';
import type { AuditLogService } from '../../audit-log/service/audit-log.service';
import type { UsersAuthorityService } from '../../users/service/authority.service';
import { ApplicationJoinCodeService } from './application-join-code.service';

const noopAuditLog = { record: jest.fn() } as unknown as AuditLogService;

const SESSION_GITHUB_ID = 4_242n;
const STAFF_ACTOR_ID = 'synthetic-staff';

type AssertActiveStaff = UsersAuthorityService['assertActiveStaff'];
type AuthorityMock = jest.Mock<
  ReturnType<AssertActiveStaff>,
  Parameters<AssertActiveStaff>
>;

function allowStaff(): AuthorityMock {
  return jest
    .fn<ReturnType<AssertActiveStaff>, Parameters<AssertActiveStaff>>()
    .mockResolvedValue({ actorId: STAFF_ACTOR_ID });
}

function denyStaff(): AuthorityMock {
  return jest.fn<ReturnType<AssertActiveStaff>, Parameters<AssertActiveStaff>>(
    (_sessionGithubId, forbidden) => Promise.reject(forbidden()),
  );
}

describe('ApplicationsService.staffSummary', () => {
  it('repository 요약을 그대로 반환한다', async () => {
    const summary: StaffDashboardSummary = {
      programs: [
        {
          id: 'program-1',
          name: '기본 프로그램',
          trackType: ProgramTrackType.EXTRACURRICULAR,
          applicationPeriod: {
            startsAt: new Date('2026-07-01T00:00:00.000Z'),
            endsAt: new Date('2026-07-31T23:59:59.000Z'),
          },
          endAt: new Date('2026-09-30T23:59:59.000Z'),
          lifecycle: ProgramLifecycle.PUBLISHED,
          applications: {
            total: 5,
            submitted: 2,
            approved: 2,
            rejected: 1,
          },
          teamManagementPath: '/programs/program-1/teams',
        },
      ],
    };
    const listStaffDashboardSummary = jest.fn().mockResolvedValue(summary);
    const repository = {
      listStaffDashboardSummary,
    } as unknown as ApplicationsRepository;
    const service = new ApplicationsService(
      repository,
      noopAuditLog,
      {
        assertActiveStaff: allowStaff(),
      },
      new ApplicationJoinCodeService({
        TEAM_JOIN_CODE_SECRET: 'synthetic-join-code-secret',
      }),
    );

    await expect(service.staffSummary(SESSION_GITHUB_ID)).resolves.toEqual(
      summary,
    );
    expect(listStaffDashboardSummary).toHaveBeenCalledTimes(1);
  });

  it('프로그램이 없으면 빈 programs 를 반환한다', async () => {
    const repository = {
      listStaffDashboardSummary: jest.fn().mockResolvedValue({ programs: [] }),
    } as unknown as ApplicationsRepository;
    const service = new ApplicationsService(
      repository,
      noopAuditLog,
      {
        assertActiveStaff: allowStaff(),
      },
      new ApplicationJoinCodeService({
        TEAM_JOIN_CODE_SECRET: 'synthetic-join-code-secret',
      }),
    );

    await expect(service.staffSummary(SESSION_GITHUB_ID)).resolves.toEqual({
      programs: [],
    });
  });

  it('교직원 권한이 없으면 APP_018 로 막고 요약을 읽지 않는다', async () => {
    const listStaffDashboardSummary = jest.fn();
    const repository = {
      listStaffDashboardSummary,
    } as unknown as ApplicationsRepository;
    const assertActiveStaff = denyStaff();
    const service = new ApplicationsService(
      repository,
      noopAuditLog,
      {
        assertActiveStaff,
      },
      new ApplicationJoinCodeService({
        TEAM_JOIN_CODE_SECRET: 'synthetic-join-code-secret',
      }),
    );

    await expect(service.staffSummary(SESSION_GITHUB_ID)).rejects.toMatchObject(
      {
        errorCode: { code: ApplicationsErrorCode.STAFF_LIST_ONLY, status: 403 },
      },
    );
    expect(assertActiveStaff).toHaveBeenCalledWith(
      SESSION_GITHUB_ID,
      expect.any(Function),
    );
    expect(listStaffDashboardSummary).not.toHaveBeenCalled();
  });
});
