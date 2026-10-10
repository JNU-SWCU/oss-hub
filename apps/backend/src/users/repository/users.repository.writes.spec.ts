import { AffiliationKind, MemberKind } from '@prisma/client';
import {
  canonicalCompletion,
  profileRecord,
} from '../service/member-authority-test-fixtures';
import {
  callOrder,
  usersRepositoryHarness as harness,
} from './users.repository.spec-support';

describe('UsersRepository profile completion writes', () => {
  const expected = profileRecord('user-complete');
  const phoneDigits = '6'.repeat(10);

  it('학생 완료는 canonical UserProfile과 rollback mirror를 같은 트랜잭션에 쓴다', async () => {
    const {
      repository,
      userUpdateMany,
      userProfileUpsert,
      userUpdate,
      recordPhoneAudit,
    } = harness(expected);
    const completion = canonicalCompletion({
      name: '합성 사용자',
      studentId: '153401',
      department: '인공지능학부',
    });

    const outcome = await repository.completeProfileIfUnchanged(
      expected,
      completion,
      recordPhoneAudit,
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
    expect(recordPhoneAudit).not.toHaveBeenCalled();
  });

  it('교직원 완료도 null 학번 canonical UserProfile을 만든다', async () => {
    const staff = profileRecord('user-complete-staff', {
      selectedMemberKind: MemberKind.STAFF,
    });
    const { repository, userProfileUpsert, recordPhoneAudit } = harness(staff);
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
      recordPhoneAudit,
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

  it('완료가 연락처를 저장하면 같은 트랜잭션 writer로 set 전이를 넘긴다', async () => {
    const completing = profileRecord('user-complete-phone');
    const {
      repository,
      userUpdate,
      recordPhoneAudit,
      transaction,
      auditLogCreate,
    } = harness(completing);

    const outcome = await repository.completeProfileIfUnchanged(
      completing,
      {
        ...canonicalCompletion({
          name: '합성 사용자',
          studentId: '153403',
          department: '인공지능학부',
        }),
        phone: phoneDigits,
      },
      recordPhoneAudit,
    );

    expect(outcome).toBe('completed');
    expect(userUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: completing.id },
      data: { phone: phoneDigits },
    });
    const [store, change] = recordPhoneAudit.mock.calls[0] ?? [];
    expect(store?.auditLogWriter).toBe(transaction);
    expect(change).toEqual({ user: completing, transition: 'set' });
    expect(change?.user).toBe(completing);
    expect(callOrder(userUpdate, 1)).toBeLessThan(callOrder(recordPhoneAudit));
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it('잠금 뒤 읽은 상태가 달라지면 conflict로 멈춘다', async () => {
    const {
      repository,
      transactionFindUnique,
      userProfileUpsert,
      recordPhoneAudit,
    } = harness(expected);
    transactionFindUnique.mockResolvedValue(null);

    const outcome = await repository.completeProfileIfUnchanged(
      expected,
      {
        ...canonicalCompletion({
          name: '합성 사용자',
          studentId: '153402',
          department: '인공지능학부',
        }),
        phone: phoneDigits,
      },
      recordPhoneAudit,
    );

    expect(outcome).toBe('conflict');
    expect(userProfileUpsert).not.toHaveBeenCalled();
    expect(recordPhoneAudit).not.toHaveBeenCalled();
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
    const {
      repository,
      userProfileUpdate,
      userUpdate,
      recordStaffNumberAudit,
      recordPhoneAudit,
    } = harness();

    await repository.updateProfileFields(
      withoutAuditIdentity,
      {
        name: '수정된 이름',
        department: '인공지능학부',
      },
      recordStaffNumberAudit,
      recordPhoneAudit,
    );

    expect(userProfileUpdate).toHaveBeenCalledWith({
      where: { userId: 'user-legacy-only' },
      data: {
        name: '수정된 이름',
        department: '인공지능학부',
        affiliationName: '인공지능학부',
      },
    });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(recordStaffNumberAudit).not.toHaveBeenCalled();
    expect(recordPhoneAudit).not.toHaveBeenCalled();
  });

  it('감사 신원이 없는 기록으로는 연락처를 쓰지 않는다', async () => {
    const { repository, userUpdate, recordStaffNumberAudit, recordPhoneAudit } =
      harness();

    await expect(
      repository.updateProfileFields(
        withoutAuditIdentity,
        {
          name: '수정된 이름',
          department: '인공지능학부',
          phone: phoneDigits,
        },
        recordStaffNumberAudit,
        recordPhoneAudit,
      ),
    ).rejects.toThrow('full user profile record');
    expect(userUpdate).not.toHaveBeenCalled();
    expect(recordPhoneAudit).not.toHaveBeenCalled();
  });

  it('잠근 사용자 행이 없으면 연락처 콜백도 부르지 않고 멈춘다', async () => {
    const current = profileRecord('user-phone-missing-row');
    const {
      repository,
      userUpdate,
      recordStaffNumberAudit,
      recordPhoneAudit,
      transaction,
    } = harness(current);
    transaction.$queryRaw.mockResolvedValue([]);

    await expect(
      repository.updateProfileFields(
        current,
        {
          name: '수정된 이름',
          department: '인공지능학부',
          phone: phoneDigits,
        },
        recordStaffNumberAudit,
        recordPhoneAudit,
      ),
    ).rejects.toThrow('Phone updates require an existing user row.');
    expect(userUpdate).not.toHaveBeenCalled();
    expect(recordPhoneAudit).not.toHaveBeenCalled();
  });

  it('연락처를 처음 저장하면 같은 트랜잭션 writer로 set 전이를 넘긴다', async () => {
    const expected = profileRecord('user-phone-set', {
      name: '기존 이름',
      phone: null,
      memberKind: MemberKind.STUDENT,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: '인공지능학부',
    });
    const {
      repository,
      userUpdate,
      recordStaffNumberAudit,
      recordPhoneAudit,
      transaction,
      auditLogCreate,
    } = harness(expected);

    await repository.updateProfileFields(
      expected,
      {
        name: '수정된 이름',
        department: '인공지능학부',
        phone: phoneDigits,
      },
      recordStaffNumberAudit,
      recordPhoneAudit,
    );

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: expected.id },
      data: { phone: phoneDigits },
    });
    const [store, change] = recordPhoneAudit.mock.calls[0] ?? [];
    expect(store?.auditLogWriter).toBe(transaction);
    expect(change).toEqual({ user: expected, transition: 'set' });
    expect(change?.user).toBe(expected);
    expect(recordPhoneAudit).toHaveBeenCalledTimes(1);
    expect(callOrder(userUpdate)).toBeLessThan(callOrder(recordPhoneAudit));
    expect(auditLogCreate).not.toHaveBeenCalled();
    expect(recordStaffNumberAudit).not.toHaveBeenCalled();
  });

  it('잠금 직전에 다른 요청이 연락처를 채웠으면 replaced 전이로 넘긴다', async () => {
    const expected = profileRecord('user-phone-concurrent', {
      name: '기존 이름',
      phone: null,
      memberKind: MemberKind.STUDENT,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: '인공지능학부',
    });
    const {
      repository,
      userUpdate,
      recordStaffNumberAudit,
      recordPhoneAudit,
      transaction,
    } = harness(expected);
    transaction.$queryRaw.mockResolvedValue([{ phone: phoneDigits }]);

    await repository.updateProfileFields(
      expected,
      {
        name: '수정된 이름',
        department: '인공지능학부',
        phone: replacementPhoneDigits,
      },
      recordStaffNumberAudit,
      recordPhoneAudit,
    );

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: expected.id },
      data: { phone: replacementPhoneDigits },
    });
    expect(recordPhoneAudit).toHaveBeenCalledWith(
      { auditLogWriter: transaction },
      { user: expected, transition: 'replaced' },
    );
  });

  it('잠근 행이 이미 같은 연락처면 쓰기도 감사도 하지 않는다', async () => {
    const expected = profileRecord('user-phone-noop', {
      name: '기존 이름',
      phone: null,
      memberKind: MemberKind.STUDENT,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: '인공지능학부',
    });
    const {
      repository,
      userUpdate,
      recordStaffNumberAudit,
      recordPhoneAudit,
      transaction,
    } = harness(expected);
    transaction.$queryRaw.mockResolvedValue([{ phone: phoneDigits }]);

    await repository.updateProfileFields(
      expected,
      {
        name: '수정된 이름',
        department: '인공지능학부',
        phone: phoneDigits,
      },
      recordStaffNumberAudit,
      recordPhoneAudit,
    );

    expect(userUpdate).not.toHaveBeenCalled();
    expect(recordPhoneAudit).not.toHaveBeenCalled();
  });

  it('연락처 감사 콜백이 실패하면 프로필 갱신 트랜잭션도 실패한다', async () => {
    const expected = profileRecord('user-phone-rollback', {
      name: '기존 이름',
      phone: phoneDigits,
      memberKind: MemberKind.STUDENT,
      affiliationKind: AffiliationKind.DEPARTMENT,
      affiliationName: '인공지능학부',
    });
    const {
      repository,
      recordStaffNumberAudit,
      recordPhoneAudit,
      transaction,
    } = harness(expected);
    const failure = new Error('synthetic audit failure');
    recordPhoneAudit.mockRejectedValue(failure);

    await expect(
      repository.updateProfileFields(
        expected,
        {
          name: '수정된 이름',
          department: '인공지능학부',
          phone: replacementPhoneDigits,
        },
        recordStaffNumberAudit,
        recordPhoneAudit,
      ),
    ).rejects.toBe(failure);

    expect(recordPhoneAudit).toHaveBeenCalledWith(
      { auditLogWriter: transaction },
      { user: expected, transition: 'replaced' },
    );
  });
});

describe('UsersRepository staff number updates', () => {
  const phoneDigits = '7'.repeat(10);
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
    const {
      repository,
      userProfileUpdate,
      recordStaffNumberAudit,
      recordPhoneAudit,
    } = harness(student);

    await expect(
      repository.updateProfileFields(
        student,
        {
          name: student.name!,
          department: student.department!,
          staffNumber: '접근-불가',
        },
        recordStaffNumberAudit,
        recordPhoneAudit,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: 'SYS_003', status: 400 },
    });
    expect(userProfileUpdate).not.toHaveBeenCalled();
    expect(recordStaffNumberAudit).not.toHaveBeenCalled();
    expect(recordPhoneAudit).not.toHaveBeenCalled();
  });

  it('현재 UserProfile 값을 잠근 뒤 번호를 저장하고 같은 writer로 감사한다', async () => {
    const {
      repository,
      userProfileUpdate,
      recordStaffNumberAudit,
      recordPhoneAudit,
      transaction,
      auditLogCreate,
    } = harness(expected);

    await repository.updateProfileFields(
      expected,
      {
        name: expected.name!,
        department: expected.department!,
        affiliationKind: AffiliationKind.PROGRAM_OFFICE,
        affiliationName: expected.department!,
        staffNumber: '교직원-𐐀',
      },
      recordStaffNumberAudit,
      recordPhoneAudit,
    );

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
    const [store, change] = recordStaffNumberAudit.mock.calls[0] ?? [];
    expect(store?.auditLogWriter).toBe(transaction);
    expect(change).toEqual({
      user: expected,
      before: null,
      after: '교직원-𐐀',
    });
    expect(change?.user).toBe(expected);
    expect(callOrder(transaction.$queryRaw)).toBeLessThan(
      callOrder(userProfileUpdate),
    );
    expect(callOrder(userProfileUpdate)).toBeLessThan(
      callOrder(recordStaffNumberAudit),
    );
    expect(auditLogCreate).not.toHaveBeenCalled();
    expect(recordPhoneAudit).not.toHaveBeenCalled();
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
    const {
      repository,
      recordStaffNumberAudit,
      recordPhoneAudit,
      transaction,
    } = harness(current);

    await repository.updateProfileFields(
      current,
      {
        name: current.name!,
        department: current.department!,
        staffNumber: null,
      },
      recordStaffNumberAudit,
      recordPhoneAudit,
    );

    expect(recordStaffNumberAudit.mock.calls).toEqual([
      [
        { auditLogWriter: transaction },
        { user: current, before: '현재-번호', after: null },
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
    const {
      repository,
      recordStaffNumberAudit,
      recordPhoneAudit,
      transaction,
    } = harness(current);
    transaction.$queryRaw
      .mockResolvedValueOnce([{ id: current.id }])
      .mockResolvedValueOnce([
        {
          staffNumber: '잠금-직전-번호',
          memberKind: MemberKind.STAFF,
        },
      ]);

    await repository.updateProfileFields(
      stale,
      {
        name: current.name!,
        department: current.department!,
        staffNumber: '새-번호',
      },
      recordStaffNumberAudit,
      recordPhoneAudit,
    );

    expect(recordStaffNumberAudit).toHaveBeenCalledWith(
      { auditLogWriter: transaction },
      { user: stale, before: '잠금-직전-번호', after: '새-번호' },
    );
  });

  it('번호와 연락처를 같이 바꾸면 번호 감사를 연락처 감사보다 먼저 부른다', async () => {
    const current = profileRecord('user-staff-number-and-phone', {
      name: '기존 이름',
      department: '인공지능학부',
      memberKind: MemberKind.STAFF,
      affiliationKind: AffiliationKind.PROGRAM_OFFICE,
      affiliationName: '인공지능학부',
      staffNumber: '기존-번호',
      phone: null,
    });
    const {
      repository,
      userProfileUpdate,
      userUpdate,
      recordStaffNumberAudit,
      recordPhoneAudit,
      transaction,
    } = harness(current);

    await repository.updateProfileFields(
      current,
      {
        name: current.name!,
        department: current.department!,
        staffNumber: '새-번호',
        phone: phoneDigits,
      },
      recordStaffNumberAudit,
      recordPhoneAudit,
    );

    expect(recordStaffNumberAudit).toHaveBeenCalledWith(
      { auditLogWriter: transaction },
      { user: current, before: '기존-번호', after: '새-번호' },
    );
    expect(recordPhoneAudit).toHaveBeenCalledWith(
      { auditLogWriter: transaction },
      { user: current, transition: 'set' },
    );
    expect(callOrder(userProfileUpdate)).toBeLessThan(
      callOrder(recordStaffNumberAudit),
    );
    expect(callOrder(recordStaffNumberAudit)).toBeLessThan(
      callOrder(userUpdate),
    );
    expect(callOrder(userUpdate)).toBeLessThan(callOrder(recordPhoneAudit));
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
    const {
      repository,
      userProfileUpdate,
      recordStaffNumberAudit,
      recordPhoneAudit,
      transaction,
    } = harness(current);

    await repository.updateProfileFields(
      current,
      {
        name: current.name!,
        department: current.department!,
      },
      recordStaffNumberAudit,
      recordPhoneAudit,
    );

    expect(userProfileUpdate).toHaveBeenCalledWith({
      where: { userId: current.id },
      data: {
        name: current.name,
        department: current.department,
        affiliationName: current.department,
      },
    });
    expect(recordStaffNumberAudit).not.toHaveBeenCalled();
    expect(recordPhoneAudit).not.toHaveBeenCalled();
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
    const { repository, recordStaffNumberAudit, recordPhoneAudit } =
      harness(current);

    await repository.updateProfileFields(
      current,
      {
        name: current.name!,
        department: current.department!,
        staffNumber: '같은-번호',
      },
      recordStaffNumberAudit,
      recordPhoneAudit,
    );

    expect(recordStaffNumberAudit).not.toHaveBeenCalled();
  });

  it('감사 신원이 없는 기록으로는 번호 감사 콜백을 부르지 않는다', async () => {
    const current = profileRecord('user-staff-number-legacy', {
      name: '기존 이름',
      department: '인공지능학부',
      memberKind: MemberKind.STAFF,
      affiliationKind: AffiliationKind.PROGRAM_OFFICE,
      affiliationName: '인공지능학부',
      staffNumber: '기존-번호',
    });
    const {
      repository,
      userProfileUpdate,
      recordStaffNumberAudit,
      recordPhoneAudit,
    } = harness(current);

    await expect(
      repository.updateProfileFields(
        {
          id: current.id,
          name: current.name,
          studentId: null,
          department: current.department,
        },
        {
          name: current.name!,
          department: current.department!,
          staffNumber: '새-번호',
        },
        recordStaffNumberAudit,
        recordPhoneAudit,
      ),
    ).rejects.toThrow(
      'Staff number updates require a full user profile record',
    );
    expect(userProfileUpdate).toHaveBeenCalledTimes(1);
    expect(recordStaffNumberAudit).not.toHaveBeenCalled();
  });

  it('번호 감사 콜백 실패는 프로필 갱신 트랜잭션도 실패시킨다', async () => {
    const current = profileRecord('user-staff-number-rollback', {
      name: '기존 이름',
      department: '인공지능학부',
      memberKind: MemberKind.STAFF,
      affiliationKind: AffiliationKind.PROGRAM_OFFICE,
      affiliationName: '인공지능학부',
      staffNumber: '기존-번호',
    });
    const {
      repository,
      recordStaffNumberAudit,
      recordPhoneAudit,
      transaction,
    } = harness(current);
    const failure = new Error('synthetic audit failure');
    recordStaffNumberAudit.mockRejectedValue(failure);

    await expect(
      repository.updateProfileFields(
        current,
        {
          name: current.name!,
          department: current.department!,
          staffNumber: '새-번호',
        },
        recordStaffNumberAudit,
        recordPhoneAudit,
      ),
    ).rejects.toBe(failure);

    expect(recordStaffNumberAudit).toHaveBeenCalledWith(
      { auditLogWriter: transaction },
      { user: current, before: '기존-번호', after: '새-번호' },
    );
    expect(recordPhoneAudit).not.toHaveBeenCalled();
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
    const { repository, userProfileUpdateMany, recordPhoneAudit } = harness();
    userProfileUpdateMany.mockResolvedValue({ count: 1 });

    const outcome = await repository.fillStudentId(
      {
        expected,
        studentId: profile.studentId,
      },
      recordPhoneAudit,
    );

    expect(outcome).toBe('filled');
    expect(userProfileUpdateMany).toHaveBeenCalledWith({
      where: { userId: expected.id, studentId: null },
      data: { studentId: profile.studentId },
    });
    expect(recordPhoneAudit).not.toHaveBeenCalled();
  });

  it('학번을 처음 채울 때 연락처도 같은 트랜잭션에서 저장하고 감사한다', async () => {
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
      recordPhoneAudit,
      transaction,
      auditLogCreate,
    } = harness(expected);
    userProfileUpdateMany.mockResolvedValue({ count: 1 });

    const outcome = await repository.fillStudentId(
      {
        expected,
        studentId: profile.studentId,
        phone: phoneDigits,
      },
      recordPhoneAudit,
    );

    expect(outcome).toBe('filled');
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: expected.id },
      data: { phone: phoneDigits },
    });
    const [store, change] = recordPhoneAudit.mock.calls[0] ?? [];
    expect(store?.auditLogWriter).toBe(transaction);
    expect(change).toEqual({ user: expected, transition: 'set' });
    expect(change?.user).toBe(expected);
    expect(callOrder(userProfileUpdateMany)).toBeLessThan(
      callOrder(userUpdate),
    );
    expect(callOrder(userUpdate)).toBeLessThan(callOrder(recordPhoneAudit));
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it('학번을 채우지 못하면 연락처도 저장하지 않고 감사도 하지 않는다', async () => {
    const { repository, userProfileUpdateMany, userUpdate, recordPhoneAudit } =
      harness();
    userProfileUpdateMany.mockResolvedValue({ count: 0 });

    const outcome = await repository.fillStudentId(
      {
        expected,
        studentId: profile.studentId,
        phone: phoneDigits,
      },
      recordPhoneAudit,
    );

    expect(outcome).toBe('conflict');
    expect(userUpdate).not.toHaveBeenCalled();
    expect(recordPhoneAudit).not.toHaveBeenCalled();
  });

  it('연락처 감사 콜백 실패는 학번 저장 트랜잭션도 실패시킨다', async () => {
    const current = profileRecord('user-fill-student-id-rollback', {
      name: '합성 학생',
      phone: null,
    });
    const { repository, userProfileUpdateMany, recordPhoneAudit } =
      harness(current);
    userProfileUpdateMany.mockResolvedValue({ count: 1 });
    const failure = new Error('synthetic audit failure');
    recordPhoneAudit.mockRejectedValue(failure);

    await expect(
      repository.fillStudentId(
        {
          expected: current,
          studentId: profile.studentId,
          phone: phoneDigits,
        },
        recordPhoneAudit,
      ),
    ).rejects.toBe(failure);
    expect(recordPhoneAudit).toHaveBeenCalledTimes(1);
  });

  it('다른 계정이 소유한 학번은 쓰지 않고 taken을 돌려준다', async () => {
    const {
      repository,
      userProfileFindUnique,
      userProfileUpdateMany,
      recordPhoneAudit,
    } = harness();
    userProfileFindUnique.mockResolvedValue({ userId: 'other-user' });

    await expect(
      repository.fillStudentId(
        { expected, studentId: profile.studentId },
        recordPhoneAudit,
      ),
    ).resolves.toBe('taken');
    expect(userProfileUpdateMany).not.toHaveBeenCalled();
    expect(recordPhoneAudit).not.toHaveBeenCalled();
  });
});
