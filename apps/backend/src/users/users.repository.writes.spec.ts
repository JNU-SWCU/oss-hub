import { AffiliationKind, MemberKind } from '@prisma/client';
import {
  canonicalCompletion,
  profileRecord,
} from './member-authority-test-fixtures';
import { usersRepositoryHarness as harness } from './users.repository.spec-support';

describe('UsersRepository profile completion writes', () => {
  const expected = profileRecord('user-complete');

  it('학생 완료는 canonical UserProfile과 rollback mirror를 같은 트랜잭션에 쓴다', async () => {
    const { repository, userUpdateMany, userProfileUpsert, userUpdate } =
      harness(expected);
    const completion = canonicalCompletion({
      name: '합성 사용자',
      studentId: '153401',
      department: '인공지능학부',
    });

    const outcome = await repository.completeProfileIfUnchanged(
      expected,
      completion,
    );

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
        selectedMemberKind: MemberKind.STUDENT,
        hasStaffAccess: false,
        hasAdminAccess: false,
      },
    });
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it('교직원 완료도 null 학번 canonical UserProfile을 만든다', async () => {
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

    const outcome = await repository.completeProfileIfUnchanged(
      staff,
      completion,
    );

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
    const { repository, transactionFindUnique, userProfileUpsert } =
      harness(expected);
    transactionFindUnique.mockResolvedValue(null);

    const outcome = await repository.completeProfileIfUnchanged(
      expected,
      canonicalCompletion({
        name: '합성 사용자',
        studentId: '153402',
        department: '인공지능학부',
      }),
    );

    expect(outcome).toBe('conflict');
    expect(userProfileUpsert).not.toHaveBeenCalled();
  });
});

describe('UsersRepository profile field updates', () => {
  const phoneDigits = '7'.repeat(10);
  const replacementPhoneDigits = '8'.repeat(10);

  const withoutAuditIdentity = {
    id: 'user-legacy-only',
    name: null,
    studentId: null,
    department: null,
    phone: null,
  };

  it('프로필 행 하나만 갱신하고 소속 사본을 함께 옺긴다', async () => {
    const { repository, userProfileUpdate, userUpdate } = harness();

    await repository.updateProfileFields(withoutAuditIdentity, {
      name: '수정된 이름',
      department: '인공지능학부',
    });

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

  it('감사 신원이 없는 기록으로는 연락처를 쓰지 않는다', async () => {
    const { repository, userUpdate } = harness();

    await expect(
      repository.updateProfileFields(withoutAuditIdentity, {
        name: '수정된 이름',
        department: '인공지능학부',
        phone: phoneDigits,
      }),
    ).rejects.toThrow('full user profile record');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('연락처를 처음 저장하면 같은 트랜잭션에 SET 감사 로그를 남긴다', async () => {
    const expected = profileRecord('user-phone-set', {
      name: '기존 이름',
      phone: null,
      memberKind: MemberKind.STUDENT,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: '인공지능학부',
    });
    const { repository, userUpdate, auditRecord, transaction } =
      harness(expected);

    await repository.updateProfileFields(expected, {
      name: '수정된 이름',
      department: '인공지능학부',
      phone: phoneDigits,
    });

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

  it('잠금 직전에 다른 요청이 연락처를 채웠으면 REPLACED로 적는다', async () => {
    const expected = profileRecord('user-phone-concurrent', {
      name: '기존 이름',
      phone: null,
      memberKind: MemberKind.STUDENT,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: '인공지능학부',
    });
    const { repository, userUpdate, auditRecord, transaction } =
      harness(expected);
    transaction.$queryRaw.mockResolvedValue([{ phone: phoneDigits }]);

    await repository.updateProfileFields(expected, {
      name: '수정된 이름',
      department: '인공지능학부',
      phone: replacementPhoneDigits,
    });

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: expected.id },
      data: { phone: replacementPhoneDigits },
    });
    expect(auditRecord.mock.calls[0]?.[0].metadata).toMatchObject({
      transition: 'REPLACED',
    });
  });

  it('잠근 행이 이미 같은 연락처면 쓰기도 감사도 하지 않는다', async () => {
    const expected = profileRecord('user-phone-noop', {
      name: '기존 이름',
      phone: null,
      memberKind: MemberKind.STUDENT,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: '인공지능학부',
    });
    const { repository, userUpdate, auditRecord, transaction } =
      harness(expected);
    transaction.$queryRaw.mockResolvedValue([{ phone: phoneDigits }]);

    await repository.updateProfileFields(expected, {
      name: '수정된 이름',
      department: '인공지능학부',
      phone: phoneDigits,
    });

    expect(userUpdate).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('연락처 감사 로그 기록이 실패하면 프로필 갱신 트랜잭션도 실패한다', async () => {
    const expected = profileRecord('user-phone-rollback', {
      name: '기존 이름',
      phone: phoneDigits,
      memberKind: MemberKind.STUDENT,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: '인공지능학부',
    });
    const { repository, auditRecord, transaction } = harness(expected);
    auditRecord.mockRejectedValue(new Error('synthetic audit failure'));

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

describe('UsersRepository staff number updates', () => {
  const expected = profileRecord('user-staff-number', {
    name: '기존 이름',
    selectedMemberKind: MemberKind.STAFF,
    studentId: null,
    memberKind: MemberKind.STAFF,
    affiliationKind: AffiliationKind.PROGRAM_OFFICE,
    affiliationName: '인공지능학부',
    department: '인공지능학부',
    staffNumber: null,
  });

  it('학생 canonical 프로필은 교직원 번호를 수정할 수 없다', async () => {
    const student = profileRecord('user-staff-number-student', {
      name: '학생',
      memberKind: MemberKind.STUDENT,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: '인공지능학부',
      department: '인공지능학부',
    });
    const { repository, userProfileUpdate, auditRecord } = harness(student);

    await expect(
      repository.updateProfileFields(student, {
        name: student.name!,
        department: student.department!,
        staffNumber: '접근-불가',
      }),
    ).rejects.toMatchObject({
      errorCode: { code: 'SYS_003', status: 400 },
    });
    expect(userProfileUpdate).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('현재 UserProfile 값을 잠근 뒤 번호를 저장하고 USER_PROFILE_UPDATED를 남긴다', async () => {
    const { repository, userProfileUpdate, auditRecord, transaction } =
      harness(expected);

    await repository.updateProfileFields(expected, {
      name: expected.name!,
      department: expected.department!,
      affiliationKind: AffiliationKind.PROGRAM_OFFICE,
      affiliationName: expected.department!,
      staffNumber: '교직원-𐐀',
    });

    expect(userProfileUpdate).toHaveBeenCalledWith({
      where: { userId: expected.id },
      data: {
        name: expected.name,
        department: expected.department,
        affiliationName: expected.department,
        affiliationKind: AffiliationKind.PROGRAM_OFFICE,
        staffNumber: '교직원-𐐀',
      },
    });
    expect(auditRecord).toHaveBeenCalledWith(
      {
        actorGithubId: expected.githubId,
        action: 'USER_PROFILE_UPDATED',
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
          changes: [
            {
              field: 'staffNumber',
              before: null,
              after: '교직원-𐐀',
            },
          ],
        },
      },
      transaction,
    );
  });

  it('번호를 null로 바꾸면 현재 값을 before로 감사한다', async () => {
    const current = profileRecord('user-staff-number-clear', {
      name: '기존 이름',
      department: '인공지능학부',
      memberKind: MemberKind.STAFF,
      affiliationKind: AffiliationKind.PROGRAM_OFFICE,
      affiliationName: '인공지능학부',
      staffNumber: '현재-번호',
    });
    const { repository, auditRecord, transaction } = harness(current);

    await repository.updateProfileFields(current, {
      name: current.name!,
      department: current.department!,
      staffNumber: null,
    });

    expect(auditRecord.mock.calls).toMatchObject([
      [
        {
          action: 'USER_PROFILE_UPDATED',
          metadata: {
            changes: [
              { field: 'staffNumber', before: '현재-번호', after: null },
            ],
          },
        },
        transaction,
      ],
    ]);
  });

  it('호출자 스냅샷보다 잠긴 현재 값을 감사 before로 사용한다', async () => {
    const current = profileRecord('user-staff-number-concurrent', {
      name: '기존 이름',
      department: '인공지능학부',
      memberKind: MemberKind.STAFF,
      affiliationKind: AffiliationKind.PROGRAM_OFFICE,
      affiliationName: '인공지능학부',
      staffNumber: '현재-번호',
    });
    const stale = { ...current, staffNumber: '오래된-스냅샷' };
    const { repository, auditRecord, transaction } = harness(current);
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: current.id }])
      .mockResolvedValueOnce([
        {
          staffNumber: '잠금-직전-번호',
          memberKind: MemberKind.STAFF,
        },
      ]);

    await repository.updateProfileFields(stale, {
      name: current.name!,
      department: current.department!,
      staffNumber: '새-번호',
    });

    expect(auditRecord.mock.calls[0]?.[0].metadata).toMatchObject({
      changes: [
        {
          field: 'staffNumber',
          before: '잠금-직전-번호',
          after: '새-번호',
        },
      ],
    });
  });

  it('번호를 생략하면 기존 값을 보존하고 감사하지 않는다', async () => {
    const current = profileRecord('user-staff-number-omitted', {
      name: '기존 이름',
      department: '인공지능학부',
      memberKind: MemberKind.STAFF,
      affiliationKind: AffiliationKind.PROGRAM_OFFICE,
      affiliationName: '인공지능학부',
      staffNumber: '기존-번호',
    });
    const { repository, userProfileUpdate, auditRecord, transaction } =
      harness(current);

    await repository.updateProfileFields(current, {
      name: current.name!,
      department: current.department!,
    });

    expect(userProfileUpdate).toHaveBeenCalledWith({
      where: { userId: current.id },
      data: {
        name: current.name,
        department: current.department,
        affiliationName: current.department,
      },
    });
    expect(auditRecord).not.toHaveBeenCalled();
    expect(transaction.$queryRaw).not.toHaveBeenCalled();
  });

  it('같은 번호를 다시 보내면 감사하지 않는다', async () => {
    const current = profileRecord('user-staff-number-noop', {
      name: '기존 이름',
      department: '인공지능학부',
      memberKind: MemberKind.STAFF,
      affiliationKind: AffiliationKind.PROGRAM_OFFICE,
      affiliationName: '인공지능학부',
      staffNumber: '같은-번호',
    });
    const { repository, auditRecord } = harness(current);

    await repository.updateProfileFields(current, {
      name: current.name!,
      department: current.department!,
      staffNumber: '같은-번호',
    });

    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('번호 감사 실패는 프로필 갱신 트랜잭션도 실패시킨다', async () => {
    const current = profileRecord('user-staff-number-rollback', {
      name: '기존 이름',
      department: '인공지능학부',
      memberKind: MemberKind.STAFF,
      affiliationKind: AffiliationKind.PROGRAM_OFFICE,
      affiliationName: '인공지능학부',
      staffNumber: '기존-번호',
    });
    const { repository, auditRecord, transaction } = harness(current);
    auditRecord.mockRejectedValue(new Error('synthetic audit failure'));

    await expect(
      repository.updateProfileFields(current, {
        name: current.name!,
        department: current.department!,
        staffNumber: '새-번호',
      }),
    ).rejects.toThrow('synthetic audit failure');

    const [auditInput, auditTransaction] = auditRecord.mock.calls[0] ?? [];
    expect(auditInput?.action).toBe('USER_PROFILE_UPDATED');
    expect(auditInput?.metadata).toMatchObject({
      changes: [
        { field: 'staffNumber', before: '기존-번호', after: '새-번호' },
      ],
    });
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
    const { repository, userProfileUpdateMany } = harness();
    userProfileUpdateMany.mockResolvedValue({ count: 1 });

    const outcome = await repository.fillStudentId({
      expected,
      studentId: profile.studentId,
    });

    expect(outcome).toBe('filled');
    expect(userProfileUpdateMany).toHaveBeenCalledWith({
      where: { userId: expected.id, studentId: null },
      data: { studentId: profile.studentId },
    });
  });

  it('PATCH가 학번을 처음 채울 때 연락처도 같은 트랜잭션에서 저장하고 감사한다', async () => {
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

    const outcome = await repository.fillStudentId({
      expected,
      studentId: profile.studentId,
      phone: phoneDigits,
    });

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
    const { repository, userProfileFindUnique, userUpdateMany } = harness();
    userProfileFindUnique.mockResolvedValue({ userId: 'other-user' });

    await expect(
      repository.fillStudentId({ expected, studentId: profile.studentId }),
    ).resolves.toBe('taken');
    expect(userUpdateMany).not.toHaveBeenCalled();
  });
});
