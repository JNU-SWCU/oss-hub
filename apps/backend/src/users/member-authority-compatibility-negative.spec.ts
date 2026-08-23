import { AffiliationKind, MemberKind } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { SystemErrorCode } from '../common/system-error-code.enum';
import type { PatchUserProfileInput } from './domain/user-profile';
import { profileRecord } from './member-authority-test-fixtures';
import { buildProfileCompletion } from './member-profile-completion';
import type { UsersRepositoryPort } from './users.repository';
import { UsersService } from './users.service';

const student = profileRecord('negative-student');
const staff = profileRecord('negative-staff', {
  memberKind: MemberKind.STAFF,
  hasStaffAccess: true,
  selectedMemberKind: MemberKind.STAFF,
});
const validStudentInput = {
  name: '합성 학생',
  studentId: '801020',
  department: '인공지능학부',
} as const;

function errorCode(operation: () => unknown): string {
  try {
    operation();
  } catch (error) {
    if (error instanceof DomainException) {
      return error.errorCode.code;
    }
    throw error;
  }
  throw new TypeError('Expected profile completion to fail');
}

describe('member authority completion negative contract', () => {
  it.each([
    [
      'partial affiliation kind',
      {
        name: '합성 학생',
        studentId: '801021',
        affiliationKind: AffiliationKind.DEPARTMENT,
      },
    ],
    [
      'partial affiliation name',
      {
        name: '합성 학생',
        studentId: '801022',
        affiliationName: '인공지능학부',
      },
    ],
  ] satisfies readonly (readonly [string, PatchUserProfileInput])[])(
    '%s fails closed',
    (_label, input) => {
      // Given / When / Then
      expect(errorCode(() => buildProfileCompletion(student, input))).toBe(
        SystemErrorCode.VALIDATION_FAILED,
      );
    },
  );

  it('blank affiliation fails closed after normalization', () => {
    // Given
    const input = { ...validStudentInput, department: '   ' };

    // When / Then
    expect(errorCode(() => buildProfileCompletion(student, input))).toBe(
      SystemErrorCode.VALIDATION_FAILED,
    );
  });

  it.each([
    [
      'missing student ID',
      student,
      { name: '합성 학생', department: '인공지능학부' },
    ],
    [
      'non-six-digit student ID',
      student,
      { ...validStudentInput, studentId: '80102' },
    ],
    ['staff student ID', staff, validStudentInput],
  ] satisfies readonly (readonly [
    string,
    typeof student,
    PatchUserProfileInput,
  ])[])('%s fails closed', (_label, target, input) => {
    // Given / When / Then
    expect(errorCode(() => buildProfileCompletion(target, input))).toBe(
      SystemErrorCode.VALIDATION_FAILED,
    );
  });

  it('duplicate student ID maps to the stable conflict code', async () => {
    // Given
    const completeProfileIfUnchanged = jest
      .fn()
      .mockResolvedValue('student-id-taken');
    const repository: UsersRepositoryPort = {
      findByGithubId: jest.fn().mockResolvedValue(student),
      completeProfileIfUnchanged,
      fillStudentId: jest.fn(),
      updateProfileFields: jest.fn(),
    };
    const service = new UsersService(repository, {
      requireCurrent: () => Promise.resolve(undefined),
    });

    // When
    const completion = service.completeMyProfile(801020n, validStudentInput);

    // Then
    await expect(completion).rejects.toMatchObject({
      errorCode: { code: 'USR_004', status: 409 },
    });
    expect(completeProfileIfUnchanged).toHaveBeenCalledTimes(1);
  });
});
