import { AffiliationKind, MemberKind } from '@prisma/client';
import {
  canonicalCompletion,
  profileRecord,
} from '../service/member-authority-test-fixtures';
import {
  callOrder,
  usersRepositoryHarness as harness,
} from './users.repository.spec-support';

const student = profileRecord('user-finishing-student');
const staff = profileRecord('user-finishing-staff', {
  selectedMemberKind: MemberKind.STAFF,
});
const studentCompletion = canonicalCompletion({
  name: '합성 학생',
  studentId: '153401',
  department: '인공지능학부',
});
const staffCompletion = canonicalCompletion(
  {
    name: '합성 교직원',
    studentId: null,
    department: '인공지능학부',
  },
  MemberKind.STAFF,
  AffiliationKind.PROGRAM_OFFICE,
);
const phoneDigits = '5'.repeat(10);

describe('UsersRepository 가입 마치기 확정', () => {
  it('학생 완료는 승인 요청을 만들지 않는다', async () => {
    const {
      repository,
      userUpdate,
      staffAccessRequestCreate,
      recordPhoneAudit,
    } = harness(student);

    const outcome = await repository.completeProfileIfUnchanged(
      student,
      studentCompletion,
      recordPhoneAudit,
    );

    expect(outcome).toBe('completed');
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: student.id },
      data: {
        selectedMemberKind: MemberKind.STUDENT,
        hasStaffAccess: false,
        hasAdminAccess: false,
      },
    });
    expect(staffAccessRequestCreate).not.toHaveBeenCalled();
    expect(recordPhoneAudit).not.toHaveBeenCalled();
  });

  it('교직원 완료는 승인 요청 하나를 연다', async () => {
    const { repository, staffAccessRequestCreate, recordPhoneAudit } =
      harness(staff);

    const outcome = await repository.completeProfileIfUnchanged(
      staff,
      staffCompletion,
      recordPhoneAudit,
    );

    expect(outcome).toBe('completed');
    expect(staffAccessRequestCreate).toHaveBeenCalledWith({
      data: { userId: staff.id },
    });
  });

  it('이미 승인 대기 요청이 있으면 다시 만들지 않는다', async () => {
    const {
      repository,
      staffAccessRequestFindFirst,
      staffAccessRequestCreate,
      recordPhoneAudit,
    } = harness(staff);
    staffAccessRequestFindFirst.mockResolvedValue({
      id: 'synthetic-existing',
      status: 'PENDING',
    });

    await repository.completeProfileIfUnchanged(
      staff,
      staffCompletion,
      recordPhoneAudit,
    );

    expect(staffAccessRequestCreate).not.toHaveBeenCalled();
  });

  it('잠금 뒤 스냅샷이 달라지면 확정 부수효과도 만들지 않는다', async () => {
    const {
      repository,
      transactionFindUnique,
      staffAccessRequestCreate,
      recordPhoneAudit,
    } = harness(staff);
    transactionFindUnique.mockResolvedValue(null);

    const outcome = await repository.completeProfileIfUnchanged(
      staff,
      { ...staffCompletion, phone: phoneDigits },
      recordPhoneAudit,
    );

    expect(outcome).toBe('conflict');
    expect(staffAccessRequestCreate).not.toHaveBeenCalled();
    expect(recordPhoneAudit).not.toHaveBeenCalled();
  });

  it('이미 교직원 접근 권한이 있으면 승인받을 것이 없다', async () => {
    const granted = profileRecord('user-granted-staff', {
      selectedMemberKind: MemberKind.STAFF,
      hasStaffAccess: true,
    });
    const { repository, staffAccessRequestCreate, recordPhoneAudit } =
      harness(granted);

    await repository.completeProfileIfUnchanged(
      granted,
      {
        ...staffCompletion,
        hasStaffAccess: true,
      },
      recordPhoneAudit,
    );

    expect(staffAccessRequestCreate).not.toHaveBeenCalled();
  });

  it('연락처 감사 콜백은 승인 요청보다 먼저 같은 writer로 불린다', async () => {
    const {
      repository,
      userUpdate,
      staffAccessRequestFindFirst,
      staffAccessRequestCreate,
      recordPhoneAudit,
      transaction,
      auditLogCreate,
    } = harness(staff);

    const outcome = await repository.completeProfileIfUnchanged(
      staff,
      { ...staffCompletion, phone: phoneDigits },
      recordPhoneAudit,
    );

    expect(outcome).toBe('completed');
    const [store, change] = recordPhoneAudit.mock.calls[0] ?? [];
    expect(store?.auditLogWriter).toBe(transaction);
    expect(change).toEqual({ user: staff, transition: 'set' });
    expect(callOrder(userUpdate, 1)).toBeLessThan(callOrder(recordPhoneAudit));
    expect(callOrder(recordPhoneAudit)).toBeLessThan(
      callOrder(staffAccessRequestFindFirst),
    );
    expect(callOrder(staffAccessRequestFindFirst)).toBeLessThan(
      callOrder(staffAccessRequestCreate),
    );
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it('연락처 감사 콜백이 실패하면 승인 요청도 열지 않는다', async () => {
    const {
      repository,
      staffAccessRequestFindFirst,
      staffAccessRequestCreate,
      recordPhoneAudit,
    } = harness(staff);
    const failure = new Error('synthetic audit failure');
    recordPhoneAudit.mockRejectedValue(failure);

    await expect(
      repository.completeProfileIfUnchanged(
        staff,
        { ...staffCompletion, phone: phoneDigits },
        recordPhoneAudit,
      ),
    ).rejects.toBe(failure);

    expect(recordPhoneAudit).toHaveBeenCalledTimes(1);
    expect(staffAccessRequestFindFirst).not.toHaveBeenCalled();
    expect(staffAccessRequestCreate).not.toHaveBeenCalled();
  });
});
