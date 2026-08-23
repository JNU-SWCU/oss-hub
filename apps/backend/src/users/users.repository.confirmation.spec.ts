import { AffiliationKind, MemberKind } from '@prisma/client';
import {
  canonicalCompletion,
  profileRecord,
} from './member-authority-test-fixtures';
import { usersRepositoryHarness as harness } from './users.repository.spec-support';

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

/**
 * 가입이 끝나는 지점의 부수효과를 고정한다(#569).
 *
 * 프로필 행이 만들어지는 순간에 회원 유형이 확정되고, 교직원에게만 승인 대기 요청이
 * 함께 열린다. 학생에게는 열 요청이 없다 — 학생의 정체성은 프로필 행 자체가 담고
 * 접근 권한은 그와 독립이기 때문이다.
 */
describe('UsersRepository 가입 마치기 확정', () => {
  it('학생 완료는 승인 요청을 만들지 않는다', async () => {
    // Given
    const { repository, userUpdate, staffAccessRequestCreate } =
      harness(student);

    // When
    const outcome = await repository.completeProfileIfUnchanged(
      student,
      studentCompletion,
    );

    // Then
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
  });

  it('교직원 완료는 승인 요청 하나를 연다', async () => {
    // Given
    const { repository, staffAccessRequestCreate } = harness(staff);

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
  });

  it('이미 승인 대기 요청이 있으면 다시 만들지 않는다', async () => {
    // Given — 사용자당 PENDING은 하나뿐이다(partial unique)
    const {
      repository,
      staffAccessRequestFindFirst,
      staffAccessRequestCreate,
    } = harness(staff);
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

  it('이미 교직원 접근 권한이 있으면 승인받을 것이 없다', async () => {
    // Given — 관리자가 미리 권한을 부여한 계정이다
    const granted = profileRecord('user-granted-staff', {
      selectedMemberKind: MemberKind.STAFF,
      hasStaffAccess: true,
    });
    const { repository, staffAccessRequestCreate } = harness(granted);

    // When
    await repository.completeProfileIfUnchanged(granted, {
      ...staffCompletion,
      hasStaffAccess: true,
    });

    // Then
    expect(staffAccessRequestCreate).not.toHaveBeenCalled();
  });
});
