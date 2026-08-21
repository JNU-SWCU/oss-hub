import { describe, expect, it } from 'vitest';
import {
  requiresLegacyMemberReclassification,
  toLegacyMemberReclassificationRequest,
} from './legacy-member-reclassification';
import type { ProfileFormValues } from './types';

const legacyAdmin = {
  status: 'assigned' as const,
  role: 'ADMIN' as const,
  memberKind: null,
  hasAdminAccess: true,
};

describe('legacy member reclassification', () => {
  it.each([
    [{ ...legacyAdmin }, true],
    [{ ...legacyAdmin, role: 'STUDENT' as const }, false],
    [{ ...legacyAdmin, memberKind: 'STUDENT' as const }, false],
    [{ ...legacyAdmin, hasAdminAccess: false }, false],
    [{ ...legacyAdmin, status: 'anonymous' as const }, false],
  ] as const)(
    'forces only the unresolved legacy ADMIN combination',
    (access, expected) => {
      // Given / When
      const result = requiresLegacyMemberReclassification(access);

      // Then
      expect(result).toBe(expected);
    },
  );

  it('builds a normalized STUDENT request with the conditional student ID', () => {
    // Given
    const values = formValues();

    // When
    const request = toLegacyMemberReclassificationRequest(values, 'STUDENT');

    // Then
    expect(request).toEqual({
      memberKind: 'STUDENT',
      name: '합성 학생 관리자',
      studentId: '760001',
      affiliationKind: 'DEPARTMENT',
      affiliationName: '합성 인공지능학부',
    });
  });

  it('builds a STAFF request without student ID', () => {
    // Given
    const values = formValues({
      studentId: '',
      affiliationKind: 'PROGRAM_OFFICE',
      affiliationName: '  합성 사업단  ',
      departmentOption: '',
    });

    // When
    const request = toLegacyMemberReclassificationRequest(values, 'STAFF');

    // Then
    expect(request).toEqual({
      memberKind: 'STAFF',
      name: '합성 학생 관리자',
      affiliationKind: 'PROGRAM_OFFICE',
      affiliationName: '합성 사업단',
    });
  });
});

function formValues(patch: Partial<ProfileFormValues> = {}): ProfileFormValues {
  return {
    name: '  합성 학생 관리자  ',
    studentId: '760001',
    savedStudentId: '',
    affiliationKind: 'DEPARTMENT',
    affiliationName: '',
    departmentOption: '합성 인공지능학부',
    otherDepartment: '',
    ...patch,
  };
}
