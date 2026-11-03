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
    departmentType: 'DEPARTMENT',
    programOfficeName: '',
    departmentOption: '인공지능학부',
    otherDepartment: '',
    ...patch,
  };
}

describe('member department completion', () => {
  it('builds a STUDENT completion with department affiliation and student ID', () => {
    const form = values({ studentId: '260821', phone: TEN_DIGIT_PHONE });

    const request = toCompleteProfileRequest(form, 'STUDENT');

    expect(request).toEqual({
      name: '합성 회원',
      studentId: '260821',
      phone: TEN_DIGIT_PHONE,
      departmentType: 'DEPARTMENT',
      department: '인공지능학부',
    });
  });

  it('builds a STAFF completion with program office and no student ID', () => {
    const form = values({
      departmentType: 'PROGRAM_OFFICE',
      programOfficeName: '  합성 사업단  ',
      departmentOption: '',
    });

    const request = toCompleteProfileRequest(form, 'STAFF');

    expect(request).toEqual({
      name: '합성 회원',
      departmentType: 'PROGRAM_OFFICE',
      department: '합성 사업단',
    });
  });

  it('rejects a student program office', () => {
    const form = values({
      studentId: '260821',
      departmentType: 'PROGRAM_OFFICE',
      programOfficeName: '합성 사업단',
      departmentOption: '',
    });

    const errors = validateProfileForm(form, 'STUDENT');

    expect(errors.department).not.toBeNull();
    expect(toCompleteProfileRequest(form, 'STUDENT')).toBeNull();
  });
});
