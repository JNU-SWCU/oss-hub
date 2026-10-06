import { describe, expect, it } from 'vitest';

import {
  isProfileFormValid,
  toCompleteProfileRequest,
  validateProfileForm,
} from '@/features/profile/profile-state';
import { profileFieldRequirement } from '@/features/profile/profile-requirements';
import type { StaffAccessRequestStatus } from '@/features/roles/types';
import type { AppRole } from '../_shell/role';
import {
  effectiveProfileRole,
  onboardingPathFor,
} from '../_shell/onboarding-route';

const CONSENT_NEXT_PATH = '/onboarding/role';

function formWithoutStudentId() {
  return {
    name: '합성 조교',
    studentId: '',
    savedStudentId: '',
    phone: '',
    affiliationKind: 'DEPARTMENT' as const,
    affiliationName: '',
    departmentOption: '인공지능학부',
    otherDepartment: '',
  };
}

describe('새 교직원 가입 동선', () => {
  it('약관 다음은 역할 선택이다', () => {
    const requestStatus: StaffAccessRequestStatus | null = null;

    expect(onboardingPathFor(requestStatus, 'incomplete')).toBe(
      CONSENT_NEXT_PATH,
    );
  });

  it('교직원을 고르면 승인 대기가 아니라 프로필 입력으로 이어진다', () => {
    const requestStatus: StaffAccessRequestStatus = 'PENDING';

    expect(onboardingPathFor(requestStatus, 'incomplete')).toBe(
      '/onboarding/profile',
    );
  });

  it('승인 전이라도 프로필 화면은 교직원 기준으로 묻는다', () => {
    const role = effectiveProfileRole(null, 'PENDING');

    const requirement = profileFieldRequirement(role);

    expect(role).toBe('STAFF');
    expect(requirement.studentId).toBe(false);
    expect(requirement.department).toBe(true);
  });

  it('학번을 한 번도 묻지 않고 프로필 저장까지 마친다', () => {
    const role = effectiveProfileRole(null, 'PENDING');
    const values = formWithoutStudentId();

    const errors = validateProfileForm(values, role);
    const request = toCompleteProfileRequest(values, role);

    expect(errors.studentId).toBeNull();
    expect(isProfileFormValid(errors)).toBe(true);
    expect(request).toEqual({
      name: '합성 조교',
      affiliationKind: 'DEPARTMENT',
      affiliationName: '인공지능학부',
    });
  });

  it('프로필을 마치면 승인 대기 화면으로 간다', () => {
    expect(onboardingPathFor('PENDING', 'complete')).toBe(
      '/onboarding/pending',
    );
  });
});

describe('legacy 관리자 호환', () => {
  it('ADMIN을 새 회원 유형으로 제출하지 않는다', () => {
    const role: AppRole = 'ADMIN';
    const values = {
      name: '합성 관리자',
      studentId: '',
      savedStudentId: '',
      phone: '',
      affiliationKind: 'DEPARTMENT' as const,
      affiliationName: '',
      departmentOption: '인공지능학부',
      otherDepartment: '',
    };

    const requirement = profileFieldRequirement(role);
    const errors = validateProfileForm(values, role);

    expect(requirement.studentId).toBe(false);
    expect(errors.studentId).toBeNull();
    expect(errors.phone).toBeNull();
    expect(errors.department).toBeNull();
    expect(toCompleteProfileRequest(values, role)).toBeNull();
  });
});
