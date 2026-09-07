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
    // `User` 행에는 canonical 접근 칸과 고른 유형만 남는다 — 프로필 mirror는 없다.
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: expected.id },
      data: {
        selectedMemberKind: MemberKind.STUDENT,
        hasStaffAccess: false,
        hasAdminAccess: false,
      },
    });
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it('교직원 완료도 null 학번 canonical UserProfile을 만든다', async () => {
    // Given
    const staff = profileRecord('user-complete-staff', {
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
      AffiliationKind.PROGRAM_OFFICE,
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
  const phoneDigits = '7'.repeat(10);
  const replacementPhoneDigits = '8'.repeat(10);

  it('프로필 행 하나만 갱신하고 소속 사본을 함께 옮긴다', async () => {
    // Given
    const { repository, userProfileUpdate, userUpdate } = harness();

    // When
    await repository.updateProfileFields('user-legacy-only', {
      name: '수정된 이름',
      department: '인공지능학부',
    });

    // Then — `department`와 `affiliationName`은 같은 사실의 두 사본이라
    // 한쪽만 쓰면 계약 CHECK가 거부한다.
    expect(userProfileUpdate).toHaveBeenCalledWith({
      where: { userId: 'user-legacy-only' },
      data: {
        name: '수정된 이름',
        department: '인공지능학부',
        affiliationName: '인공지능학부',
      },
    });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('legacy profile field writes reject phone because audit identity is missing', async () => {
    // Given
    const { repository, userUpdate } = harness();

    // When / Then
    await expect(
      repository.updateProfileFields('user-legacy-only', {
        name: '수정된 이름',
        department: '인공지능학부',
        phone: phoneDigits,
      }),
    ).rejects.toThrow('full user profile record');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('연락처를 처음 저장하면 같은 트랜잭션에 SET 감사 로그를 남긴다', async () => {
    // Given
    const expected = profileRecord('user-phone-set', {
      name: '기존 이름',
      phone: null,
      memberKind: MemberKind.STUDENT,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: '인공지능학부',
    });
    const { repository, userUpdate, auditRecord, transaction } =
      harness(expected);

    // When
    await repository.updateProfileFields(expected, {
      name: '수정된 이름',
      department: '인공지능학부',
      phone: phoneDigits,
    });

    // Then
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: expected.id },
      data: { phone: phoneDigits },
    });
    expect(auditRecord).toHaveBeenCalledWith(
      {
        actorGithubId: expected.githubId,
        action: 'USER_PHONE_UPDATED',
        targetType: 'USER',
        targetId: expected.id,
        metadata: {
          schemaVersion: 1,
          actor: {
            displayName: expected.name,
            githubLogin: expected.githubLogin,
          },
          target: {
            displayName: expected.name,
            githubLogin: expected.githubLogin,
          },
          transition: 'SET',
        },
      },
      transaction,
    );
    const metadata = auditRecord.mock.calls[0]?.[0].metadata;
    expect(metadata).not.toHaveProperty('value');
    expect(metadata).not.toHaveProperty('hash');
    expect(metadata).not.toHaveProperty('suffix');
    expect(metadata).not.toHaveProperty('mask');
    expect(metadata).not.toHaveProperty('phone');
  });

  it('연락처 감사 로그 기록이 실패하면 프로필 갱신 트랜잭션도 실패한다', async () => {
    // Given
    const expected = profileRecord('user-phone-rollback', {
      name: '기존 이름',
      phone: phoneDigits,
      memberKind: MemberKind.STUDENT,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: '인공지능학부',
    });
    const { repository, auditRecord, transaction } = harness(expected);
    auditRecord.mockRejectedValue(new Error('synthetic audit failure'));

    // When / Then
    await expect(
      repository.updateProfileFields(expected, {
        name: '수정된 이름',
        department: '인공지능학부',
        phone: replacementPhoneDigits,
      }),
    ).rejects.toThrow('synthetic audit failure');
    const [auditInput, auditTransaction] = auditRecord.mock.calls[0] ?? [];
    expect(auditInput?.action).toBe('USER_PHONE_UPDATED');
    expect(auditInput?.metadata).toMatchObject({ transition: 'REPLACED' });
    expect(auditTransaction).toBe(transaction);
  });
});

describe('UsersRepository 학번 최초 저장', () => {
  const phoneDigits = '9'.repeat(11);
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
    const outcome = await repository.fillStudentId(expected, profile.studentId);

    // Then — `studentId: null` 조건이 CAS다
    expect(outcome).toBe('filled');
    expect(userProfileUpdateMany).toHaveBeenCalledWith({
      where: { userId: expected.id, studentId: null },
      data: { studentId: profile.studentId },
    });
  });

  it('PATCH가 학번을 처음 채울 때 연락처도 같은 트랜잭션에서 저장하고 감사한다', async () => {
    // Given
    const expected = profileRecord('user-fill-student-id-with-phone', {
      name: '합성 학생',
      phone: null,
      memberKind: MemberKind.STUDENT,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: '인공지능학부',
    });
    const {
      repository,
      userProfileUpdateMany,
      userUpdate,
      auditRecord,
      transaction,
    } = harness(expected);
    userProfileUpdateMany.mockResolvedValue({ count: 1 });

    // When
    const outcome = await repository.fillStudentId({
      expected,
      studentId: profile.studentId,
      phone: phoneDigits,
    });

    // Then
    expect(outcome).toBe('filled');
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: expected.id },
      data: { phone: phoneDigits },
    });
    const [auditInput, auditTransaction] = auditRecord.mock.calls[0] ?? [];
    expect(auditInput?.action).toBe('USER_PHONE_UPDATED');
    expect(auditInput?.metadata).toMatchObject({ transition: 'SET' });
    expect(auditTransaction).toBe(transaction);
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
