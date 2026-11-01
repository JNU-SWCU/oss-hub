import { ProgramListStatusFilterRepository } from './program-list-status-filter.repository';
import { PlatformRepository } from '../platform/platform.repository';
import { AccountStatus, MemberKind } from '@prisma/client';
import type { PrismaService } from '../platform/prisma.service';
import { ProgramViewerService } from './program-viewer.service';
import { ProgramsRepository } from './programs.repository';
import { UserProfileService } from '../users/user-profile.service';

const githubId = 424242n;

function serviceFor(user: unknown) {
  const findUnique = jest.fn().mockResolvedValue(user);
  const prisma = { user: { findUnique } } as unknown as PrismaService;
  return new ProgramViewerService(
    new ProgramsRepository(
      prisma,
      new PlatformRepository(),
      new ProgramListStatusFilterRepository(),
    ),
    new UserProfileService(),
  );
}

function viewerRecord(fields: {
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly accountStatus?: AccountStatus;
}) {
  return {
    id: 'user-1',
    accountStatus: fields.accountStatus ?? AccountStatus.ACTIVE,
    hasStaffAccess: fields.hasStaffAccess,
    hasAdminAccess: fields.hasAdminAccess,
    profile:
      fields.memberKind === null ? null : { memberKind: fields.memberKind },
    staffAccessRequests: [],
  };
}

describe('ProgramViewerService', () => {
  it('운영 권한 없는 학생은 operations 요청으로 권한이 올라가지 않는다', async () => {
    const service = serviceFor(
      viewerRecord({
        memberKind: MemberKind.STUDENT,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
    );
    await expect(
      service.fromGithubId(githubId, 'program-1', true),
    ).resolves.toMatchObject({ role: 'STUDENT' });
  });

  it('학생 유형이 아닌 운영자는 참여와 무관하게 운영 화면을 유지한다', async () => {
    const findStudentApplication = jest.fn();
    const service = new ProgramViewerService(
      {
        findViewer: jest.fn().mockResolvedValue(
          viewerRecord({
            memberKind: MemberKind.STAFF,
            hasStaffAccess: true,
            hasAdminAccess: false,
          }),
        ),
        findStudentApplication,
      } as unknown as ProgramsRepository,
      new UserProfileService(),
    );
    await expect(
      service.fromGithubId(githubId, 'program-1'),
    ).resolves.toMatchObject({ role: 'STAFF' });
    expect(findStudentApplication).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    '참여 학생의 기본 상세는 학생이고 운영 전환=%s에서는 원래 권한을 쓴다',
    async (operations) => {
      const findStudentApplication = jest
        .fn()
        .mockResolvedValue({ status: 'APPROVED' });
      const service = new ProgramViewerService(
        {
          findViewer: jest.fn().mockResolvedValue(
            viewerRecord({
              memberKind: MemberKind.STUDENT,
              hasStaffAccess: true,
              hasAdminAccess: true,
            }),
          ),
          findStudentApplication,
        } as unknown as ProgramsRepository,
        new UserProfileService(),
      );

      await expect(
        service.fromGithubId(githubId, 'program-1', operations),
      ).resolves.toMatchObject({ role: operations ? 'ADMIN' : 'STUDENT' });
    },
  );

  it.each([null, { status: 'SUBMITTED' }])(
    '미참여·미승인 학생 운영자는 운영 화면을 유지한다 (%s)',
    async (application) => {
      const service = new ProgramViewerService(
        {
          findViewer: jest.fn().mockResolvedValue(
            viewerRecord({
              memberKind: MemberKind.STUDENT,
              hasStaffAccess: true,
              hasAdminAccess: false,
            }),
          ),
          findStudentApplication: jest.fn().mockResolvedValue(application),
        } as unknown as ProgramsRepository,
        new UserProfileService(),
      );
      await expect(
        service.fromGithubId(githubId, 'program-1'),
      ).resolves.toMatchObject({ role: 'STAFF' });
    },
  );

  it('비활성 교직원은 비공개 조회 권한을 얻지 못한다', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 'staff-1',
      hasStaffAccess: true,
      hasAdminAccess: false,
      accountStatus: AccountStatus.DEACTIVATED,
      staffAccessRequests: [],
    });
    const prisma = { user: { findUnique } } as unknown as PrismaService;
    const service = new ProgramViewerService(
      new ProgramsRepository(
        prisma,
        new PlatformRepository(),
        new ProgramListStatusFilterRepository(),
      ),
      new UserProfileService(),
    );

    const viewer = await service.fromGithubId(githubId);

    expect(viewer).toEqual({ githubId, userId: null, role: null });
    expect(findUnique).toHaveBeenCalledWith({
      where: { githubId },
      select: {
        id: true,
        accountStatus: true,
        hasStaffAccess: true,
        hasAdminAccess: true,
        profile: { select: { memberKind: true } },
        staffAccessRequests: {
          where: { status: 'PENDING' },
          select: { id: true },
          take: 1,
        },
      },
    });
  });

  it('학생 유형이면 교직원·관리자 권한이 함께 있어도 학생으로 읽는다', async () => {
    const service = serviceFor(
      viewerRecord({
        memberKind: MemberKind.STUDENT,
        hasStaffAccess: true,
        hasAdminAccess: true,
      }),
    );

    await expect(service.fromGithubId(githubId)).resolves.toMatchObject({
      role: 'ADMIN',
    });
    await expect(service.studentFromGithubId(githubId)).resolves.toEqual({
      githubId,
      userId: 'user-1',
    });
  });

  it.each([
    [
      '학생 유형이 아닌 교직원',
      viewerRecord({
        memberKind: MemberKind.STAFF,
        hasStaffAccess: true,
        hasAdminAccess: false,
      }),
    ],
    [
      '프로필 없는 관리자',
      viewerRecord({
        memberKind: null,
        hasStaffAccess: false,
        hasAdminAccess: true,
      }),
    ],
    [
      '비활성 학생',
      viewerRecord({
        memberKind: MemberKind.STUDENT,
        hasStaffAccess: false,
        hasAdminAccess: false,
        accountStatus: AccountStatus.DEACTIVATED,
      }),
    ],
    ['가입하지 않은 사용자', null],
  ])('%s는 학생으로 읽지 않는다', async (_label, user) => {
    await expect(
      serviceFor(user).studentFromGithubId(githubId),
    ).resolves.toBeNull();
  });
});
