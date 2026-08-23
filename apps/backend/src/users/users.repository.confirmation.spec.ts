import { MemberKind, Role } from '@prisma/client';
import {
  canonicalCompletion,
  profileRecord,
} from './member-authority-test-fixtures';
import { usersRepositoryHarness as harness } from './users.repository.spec-support';

const student = profileRecord('user-finishing-student');
const staff = profileRecord('user-finishing-staff', {
  selectedRole: Role.STAFF,
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
);

describe('UsersRepository 가입 마치기 확정', () => {
  it('학생 완료는 rollback 역할도 같은 트랜잭션에서 배정한다', async () => {
    // Given
    const { repository, userUpdateMany, staffAccessRequestCreate } = harness(student);

    // When
    const outcome = await repository.completeProfileIfUnchanged(
      student,
      studentCompletion,
    );

    // Then
    expect(outcome).toBe('completed');
    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: student.id, role: null },
      data: { role: Role.STUDENT },
    });
    expect(staffAccessRequestCreate).not.toHaveBeenCalled();
  });

  it('교직원 완료는 rollback 역할 없이 승인 요청 하나를 만든다', async () => {
    // Given
    const { repository, staffAccessRequestCreate, userUpdateMany } = harness(staff);

    // When
    const outcome = await repository.completeProfileIfUnchanged(
      staff,
      staffCompletion,
    );

    // Then
    expect(outcome).toBe('completed');
    expect(staffAccessRequestCreate).toHaveBeenCalledWith({
      data: { userId: staff.id },
    });
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it('이미 승인 대기 요청이 있으면 다시 만들지 않는다', async () => {
    // Given
    const { repository, staffAccessRequestFindFirst, staffAccessRequestCreate } =
      harness(staff);
    staffAccessRequestFindFirst.mockResolvedValue({
      id: 'synthetic-existing',
      status: 'PENDING',
    });

    // When
    await repository.completeProfileIfUnchanged(staff, staffCompletion);

    // Then
    expect(staffAccessRequestCreate).not.toHaveBeenCalled();
  });

  it('잠금 뒤 스냅샷이 달라지면 확정 부수효과도 만들지 않는다', async () => {
    // Given
    const { repository, transactionFindUnique, staffAccessRequestCreate } =
      harness(staff);
    transactionFindUnique.mockResolvedValue(null);

    // When
    const outcome = await repository.completeProfileIfUnchanged(
      staff,
      staffCompletion,
    );

    // Then
    expect(outcome).toBe('conflict');
    expect(staffAccessRequestCreate).not.toHaveBeenCalled();
  });

  it('canonical 선택은 비어 있는 legacy 선택을 복구한다', async () => {
    // Given
    const missingLegacySelection = profileRecord('user-canonical-selection', {
      selectedRole: null,
      selectedMemberKind: MemberKind.STUDENT,
    });
    const { repository, userUpdateMany } = harness(missingLegacySelection);

    // When
    await repository.completeProfileIfUnchanged(
      missingLegacySelection,
      studentCompletion,
    );

    // Then
    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { id: missingLegacySelection.id, role: null },
      data: { role: Role.STUDENT },
    });
  });

  it('이미 확정된 rollback 역할은 다시 계산하지 않는다', async () => {
    // Given
    const confirmed = profileRecord('user-confirmed-staff', {
      role: Role.STAFF,
      selectedRole: Role.STAFF,
      selectedMemberKind: MemberKind.STAFF,
      hasStaffAccess: true,
    });
    const { repository, userUpdateMany, staffAccessRequestCreate } =
      harness(confirmed);

    // When
    await repository.completeProfileIfUnchanged(confirmed, staffCompletion);

    // Then
    expect(staffAccessRequestCreate).not.toHaveBeenCalled();
    expect(userUpdateMany).not.toHaveBeenCalled();
  });
});
