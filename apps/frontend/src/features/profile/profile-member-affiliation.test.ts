import { describe, expect, it } from 'vitest';
import { toCompleteProfileRequest, validateProfileForm } from './profile-state';
import type { ProfileFormValues } from './types';

const TEN_DIGIT_PHONE = '1'.repeat(10);

function values(patch: Partial<ProfileFormValues> = {}): ProfileFormValues {
  return {
    name: '합성 회원',
    studentId: '',
    phone: '',
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
    const form = values({ studentId: '260821', phone: TEN_DIGIT_PHONE });

    const request = toCompleteProfileRequest(form, 'STUDENT');

    expect(request).toEqual({
      name: '합성 회원',
      studentId: '260821',
      phone: TEN_DIGIT_PHONE,
      affiliationKind: 'DEPARTMENT',
      affiliationName: '인공지능학부',
    });
  });

  it('builds a STAFF completion with program-office affiliation and no student ID', () => {
    const form = values({
      affiliationKind: 'PROGRAM_OFFICE',
      affiliationName: '  합성 사업단  ',
      departmentOption: '',
    });

    const request = toCompleteProfileRequest(form, 'STAFF');

    expect(request).toEqual({
      name: '합성 회원',
      affiliationKind: 'PROGRAM_OFFICE',
      affiliationName: '합성 사업단',
    });
  });

  it('rejects a student program-office affiliation', () => {
    const form = values({
      studentId: '260821',
      affiliationKind: 'PROGRAM_OFFICE',
      affiliationName: '합성 사업단',
      departmentOption: '',
    });

    const errors = validateProfileForm(form, 'STUDENT');

    expect(errors.department).not.toBeNull();
    expect(toCompleteProfileRequest(form, 'STUDENT')).toBeNull();
  });
});
