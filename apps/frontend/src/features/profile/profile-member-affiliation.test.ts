import { describe, expect, it } from 'vitest';
import { toCompleteProfileRequest, validateProfileForm } from './profile-state';
import type { ProfileFormValues } from './types';

function values(patch: Partial<ProfileFormValues> = {}): ProfileFormValues {
  return {
    name: '합성 회원',
    studentId: '',
    savedStudentId: '',
    affiliationKind: 'DEPARTMENT',
    affiliationName: '',
    departmentOption: '인공지능학부',
    otherDepartment: '',
    ...patch,
  };
}

describe('member affiliation completion', () => {
  it('builds a STUDENT completion with department affiliation and student ID', () => {
    // Given: valid student identity and department values.
    const form = values({ studentId: '260821' });
    // When: the canonical completion request is built.
    const request = toCompleteProfileRequest(form, 'STUDENT');
    // Then: member-dependent affiliation and ID fields are explicit.
    expect(request).toEqual({
      name: '합성 회원',
      studentId: '260821',
      affiliationKind: 'DEPARTMENT',
      affiliationName: '인공지능학부',
    });
  });

  it('builds a STAFF completion with program-office affiliation and no student ID', () => {
    // Given: a staff member chose a program office.
    const form = values({
      affiliationKind: 'PROGRAM_OFFICE',
      affiliationName: '  합성 사업단  ',
      departmentOption: '',
    });
    // When: the canonical completion request is built.
    const request = toCompleteProfileRequest(form, 'STAFF');
    // Then: the normalized office is sent without a student ID.
    expect(request).toEqual({
      name: '합성 회원',
      affiliationKind: 'PROGRAM_OFFICE',
      affiliationName: '합성 사업단',
    });
  });

  it('rejects a student program-office affiliation', () => {
    // Given: a student selected an affiliation kind reserved for staff.
    const form = values({
      studentId: '260821',
      affiliationKind: 'PROGRAM_OFFICE',
      affiliationName: '합성 사업단',
      departmentOption: '',
    });
    // When: the form is validated.
    const errors = validateProfileForm(form, 'STUDENT');
    // Then: the affiliation is rejected before a request is sent.
    expect(errors.department).not.toBeNull();
    expect(toCompleteProfileRequest(form, 'STUDENT')).toBeNull();
  });
});
