import { AffiliationKind, MemberKind } from '@prisma/client';
import {
  canonicalCompletion,
  profileRecord,
} from './member-authority-test-fixtures';
import { usersRepositoryHarness as harness } from './users.repository.spec-support';

describe('UsersRepository profile completion writes', () => {
  const expected = profileRecord('user-complete');

  it('학생 완료는 canonical UserProfile과 rollback mirror를 같은 트랜잭션에 쓴다', async () => {
    // Given
    const { repository, userUpdateMany, userProfileUpsert, userUpdate } =
      harness(expected);
    const completion = canonicalCompletion({
      name: '합성 사용자',
      studentId: '153401',
      department: '인공지능학부',
    });

    // When
    const outcome = await repository.completeProfileIfUnchanged(
      expected,
      completion,
    );

    // Then
    expect(outcome).toBe('completed');
    const profileData = {
      name: completion.name,
      studentId: completion.studentId,
      department: completion.department,
      memberKind: completion.memberKind,
      affiliationKind: completion.affiliationKind,
      affiliationName: completion.affiliationName,
    };
    expect(userProfileUpsert).toHaveBeenCalledWith({
      where: { userId: expected.id },
      update: profileData,
      create: { userId: expected.id, ...profileData },
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: expected.id },
      data: {
        name: completion.name,
        studentId: completion.studentId,
        department: completion.department,
        memberKind: MemberKind.STUDENT,
        affiliationKind: AffiliationKind.DEPARTMENT,
        affiliationName: completion.department,
        selectedMemberKind: MemberKind.STUDENT,
        hasStaffAccess: false,
        hasAdminAccess: false,
      },
    });
    expect(userUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('교직원 완료도 null 학번 canonical UserProfile을 만든다', async () => {
    // Given
    const staff = profileRecord('user-complete-staff', {
      memberKind: MemberKind.STAFF,
      hasStaffAccess: true,
      selectedMemberKind: MemberKind.STAFF,
    });
    const { repository, userProfileUpsert } = harness(staff);
    const completion = canonicalCompletion(
      {
        name: '합성 교직원',
        studentId: null,
        department: '인공지능학부',
      },
      MemberKind.STAFF,
    );

    // When
    const outcome = await repository.completeProfileIfUnchanged(
      staff,
      completion,
    );

    // Then
    expect(outcome).toBe('completed');
    const profileData = {
      name: completion.name,
      studentId: null,
      department: completion.department,
      memberKind: MemberKind.STAFF,
      affiliationKind: completion.affiliationKind,
      affiliationName: completion.affiliationName,
    };
    expect(userProfileUpsert).toHaveBeenCalledWith({
      where: { userId: staff.id },
      update: profileData,
      create: { userId: staff.id, ...profileData },
    });
  });

  it('잠금 뒤 읽은 상태가 달라지면 conflict로 멈춘다', async () => {
    // Given
    const { repository, transactionFindUnique, userProfileUpsert } =
      harness(expected);
    transactionFindUnique.mockResolvedValue(null);

    // When
    const outcome = await repository.completeProfileIfUnchanged(
      expected,
      canonicalCompletion({
        name: '합성 사용자',
        studentId: '153402',
        department: '인공지능학부',
      }),
    );

    // Then
    expect(outcome).toBe('conflict');
    expect(userProfileUpsert).not.toHaveBeenCalled();
  });
});

describe('UsersRepository profile field updates', () => {
  it('UserProfile 행이 없어도 실패하지 않고 User 컬럼을 갱신한다', async () => {
    // Given
    const { repository, userProfileUpdateMany, userUpdate } = harness();

    // When
    await repository.updateProfileFields('user-legacy-only', {
      name: '수정된 이름',
      department: '인공지능학부',
    });

    // Then
    expect(userProfileUpdateMany).toHaveBeenCalledWith({
      where: { userId: 'user-legacy-only' },
      data: { name: '수정된 이름', department: '인공지능학부' },
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-legacy-only' },
      data: { name: '수정된 이름', department: '인공지능학부' },
    });
  });
});

describe('UsersRepository 학번 최초 저장', () => {
  const expected = {
    id: 'user-legacy-only',
    role: 'STAFF' as const,
    name: '합성 교직원',
    studentId: null,
    department: '인공지능학부',
    memberKind: MemberKind.STAFF,
    affiliationKind: AffiliationKind.PROGRAM_OFFICE,
    affiliationName: '인공지능학부',
  };
  const profile = {
    name: '합성 교직원',
    studentId: '153406',
    department: '인공지능학부',
    memberKind: MemberKind.STUDENT,
    affiliationKind: AffiliationKind.DEPARTMENT,
    affiliationName: '인공지능학부',
  };

  it('UserProfile 행이 없던 교직원도 행을 만들어 제약 아래 학번을 넣는다', async () => {
    // Given — 학번은 프로필 행의 unique 제약 아래로만 들어간다
    const { repository, userProfileUpdateMany } = harness();
    userProfileUpdateMany.mockResolvedValue({ count: 1 });

    // When
    const outcome = await repository.fillStudentId(
      expected,
      profile.studentId,
    );

    // Then — `studentId: null` 조건이 CAS다
    expect(outcome).toBe('filled');
    expect(userProfileUpdateMany).toHaveBeenCalledWith({
      where: { userId: expected.id, studentId: null },
      data: { studentId: profile.studentId },
    });
  });

  it('다른 계정이 소유한 학번은 쓰지 않고 taken을 돌려준다', async () => {
    // Given
    const { repository, userProfileFindUnique, userUpdateMany } = harness();
    userProfileFindUnique.mockResolvedValue({ userId: 'other-user' });

    // When / Then
    await expect(
      repository.fillStudentId(expected, profile.studentId),
    ).resolves.toBe('taken');
    expect(userUpdateMany).not.toHaveBeenCalled();
  });
});
