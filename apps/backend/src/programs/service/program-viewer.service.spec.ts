import { AccountStatus, MemberKind } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { ProgramViewerService } from './program-viewer.service';
import { ProgramsRepository } from '../repository/programs.repository';

const githubId = 424242n;

function serviceFor(user: unknown) {
  const findUnique = jest.fn().mockResolvedValue(user);
  const prisma = { user: { findUnique } } as unknown as PrismaService;
  return new ProgramViewerService(new ProgramsRepository(prisma));
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
  it('비활성 교직원은 비공개 조회 권한을 얻지 못한다', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 'staff-1',
      hasStaffAccess: true,
      hasAdminAccess: false,
      accountStatus: AccountStatus.DEACTIVATED,
      staffAccessRequests: [],
    });
    const prisma = { user: { findUnique } } as unknown as PrismaService;
    const service = new ProgramViewerService(new ProgramsRepository(prisma));

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
