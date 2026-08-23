import { AccountStatus } from '@prisma/client';
import { AuthRepository } from './auth.repository';
import {
  buildAuthConfig,
  buildRow,
  prismaServiceWith,
} from './auth.repository.spec-support';

describe('AuthRepository.findByGithubId', () => {
  it('DB role·accountStatus를 그대로 도메인 객체에 실어 반환한다', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValue(buildRow({ role: 'STAFF' }));
    const prisma = prismaServiceWith({ user: { findUnique } });
    const config = buildAuthConfig();
    const repository = new AuthRepository(prisma, config);

    expect(await repository.findByGithubId(424_242n)).toMatchObject({
      role: 'STAFF',
      accountStatus: AccountStatus.ACTIVE,
    });
  });

  it('canonical principal keeps student membership and independent admin authority', async () => {
    // Given
    const findUnique = jest.fn().mockResolvedValue({
      ...buildRow({
        role: 'ADMIN',
        hasStaffAccess: false,
        hasAdminAccess: true,
      }),
      selectedRole: 'STUDENT',
      selectedMemberKind: 'STUDENT',
      profile: {
        name: '합성 학생 관리자',
        studentId: '801030',
        department: '인공지능학부',
        memberKind: 'STUDENT',
        affiliationKind: 'DEPARTMENT',
        affiliationName: '인공지능학부',
      },
    });
    const repository = new AuthRepository(
      prismaServiceWith({ user: { findUnique } }),
      buildAuthConfig(),
    );

    // When
    const principal = await repository.findByGithubId(424_242n);

    // Then
    expect(principal).toMatchObject({
      role: 'ADMIN',
      memberKind: 'STUDENT',
      hasStaffAccess: false,
      hasAdminAccess: true,
      isProfileComplete: true,
    });
  });
});
