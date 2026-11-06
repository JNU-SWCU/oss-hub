import { UserProfileService } from '../users/user-profile.service';
import { USER_AUTHORITY_SELECT } from '../platform/user-profile-read.config';
import {
  ProgramListStatusFilterRepository,
  ProgramsRepository,
} from './programs.repository';
import { PlatformRepository } from '../platform/platform.repository';
import { AccountStatus } from '@prisma/client';
import { MemberKind } from '../users/user-contract.config';
import type { PrismaService } from '../platform/prisma.service';
import { ProgramViewerService } from './program-viewer.service';

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
    type: fields.memberKind ?? 'UNSELECTED',
    approvalStatus:
      fields.memberKind === 'STAFF'
        ? fields.hasStaffAccess
          ? 'APPROVED'
          : 'PENDING'
        : 'NOT_REQUIRED',
    name: 'Synthetic viewer',
    department: 'Synthetic department',
    profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
    admin: fields.hasAdminAccess ? { userId: 'user-1' } : null,
  };
}

describe('ProgramViewerService', () => {
  it('운영 권한 없는 학생은 학생으로 조회한다', async () => {
    const service = serviceFor(
      viewerRecord({
        memberKind: MemberKind.STUDENT,
        hasStaffAccess: false,
        hasAdminAccess: false,
      }),
    );
    await expect(service.fromGithubId(githubId)).resolves.toMatchObject({
      role: 'STUDENT',
    });
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
    await expect(service.fromGithubId(githubId)).resolves.toMatchObject({
      role: 'STAFF',
    });
    expect(findStudentApplication).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    '학생은 관리자 권한=%s에서도 학생 업무로 조회한다',
    async (hasAdminAccess) => {
      const findStudentApplication = jest
        .fn()
        .mockResolvedValue({ status: 'APPROVED' });
      const service = new ProgramViewerService(
        {
          findViewer: jest.fn().mockResolvedValue(
            viewerRecord({
              memberKind: MemberKind.STUDENT,
              hasStaffAccess: true,
              hasAdminAccess,
            }),
          ),
          findStudentApplication,
        } as unknown as ProgramsRepository,
        new UserProfileService(),
      );

      await expect(service.fromGithubId(githubId)).resolves.toMatchObject({
        role: 'STUDENT',
      });
    },
  );

  it.each([null, { status: 'SUBMITTED' }])(
    '미참여·미승인 학생에게 운영 권한을 만들지 않는다 (%s)',
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
      await expect(service.fromGithubId(githubId)).resolves.toMatchObject({
        role: 'STUDENT',
      });
    },
  );

  it('비활성 교직원은 비공개 조회 권한을 얻지 못한다', async () => {
    const findUnique = jest.fn().mockResolvedValue(
      viewerRecord({
        memberKind: MemberKind.STAFF,
        hasStaffAccess: true,
        hasAdminAccess: false,
        accountStatus: AccountStatus.DEACTIVATED,
      }),
    );
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
        ...USER_AUTHORITY_SELECT,
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
      role: 'STUDENT',
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
