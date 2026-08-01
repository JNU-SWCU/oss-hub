/**
 * 가입 동선 전체를 한 번에 고정한다 — 약관 → 역할 → 프로필.
 *
 * 조각별 테스트(`onboarding-route`, `profile-state`)는 각자 맞아도 순서가 어긋나면
 * 제품 약속이 깨진다. 실제로 그랬다: 프로필을 먼저 받던 순서에서는 그 화면이 역할을
 * 몰라 학생 기준으로 판정했고, 학번이 없는 교직원·관리자가 가짜 학번을 지어내야
 * 가입을 마칠 수 있었다. 이 파일은 "새로 가입하는 교직원·관리자에게 학번을 묻지
 * 않는다"를 동선 순서로 증명한다 — 예전 순서에서는 통과할 수 없는 검사다.
 */
import { describe, expect, it } from 'vitest';

import {
  isProfileFormValid,
  toCompleteProfileRequest,
  validateProfileForm,
} from '@/features/profile/profile-state';
import { profileFieldRequirement } from '@/features/profile/profile-requirements';
import type { RoleRequestStatus } from '@/features/roles/types';
import type { AppRole } from '../_shell/role';
import {
  effectiveProfileRole,
  onboardingPathFor,
} from '../_shell/onboarding-route';

const CONSENT_NEXT_PATH = '/onboarding/role';

/** 이름·학과만 채운 폼. 학번 칸은 손대지 않았다. */
function formWithoutStudentId() {
  return {
    name: '합성 조교',
    studentId: '',
    departmentOption: '인공지능학부',
    otherDepartment: '',
  };
}

describe('새 교직원 가입 동선', () => {
  it('약관 다음은 역할 선택이다', () => {
    // Given — 방금 동의를 마쳤고 아직 아무 역할도 고르지 않았다
    const requestStatus: RoleRequestStatus | null = null;

    // When / Then — 백엔드 동의 정책의 nextUrl과 같은 곳이다
    expect(onboardingPathFor(requestStatus, 'incomplete')).toBe(
      CONSENT_NEXT_PATH,
    );
  });

  it('교직원을 고르면 승인 대기가 아니라 프로필 입력으로 이어진다', () => {
    // Given — 승인을 기다리는 동안 프로필을 채우는 사람이 바로 이 교직원이다
    const requestStatus: RoleRequestStatus = 'PENDING';

    // When / Then
    expect(onboardingPathFor(requestStatus, 'incomplete')).toBe(
      '/onboarding/profile',
    );
  });

  it('승인 전이라도 프로필 화면은 교직원 기준으로 묻는다', () => {
    // Given — 승인 전까지 세션의 role은 비어 있다
    const role = effectiveProfileRole(null, 'PENDING');

    // When
    const requirement = profileFieldRequirement(role);

    // Then — 여기서 학생 기준으로 되돌아가던 것이 이 결함의 핵심이었다
    expect(role).toBe('STAFF');
    expect(requirement.studentId).toBe(false);
    expect(requirement.department).toBe(true);
  });

  it('학번을 한 번도 묻지 않고 프로필 저장까지 마친다', () => {
    // Given
    const role = effectiveProfileRole(null, 'PENDING');
    const values = formWithoutStudentId();

    // When
    const errors = validateProfileForm(values, role);
    const request = toCompleteProfileRequest(values, role);

    // Then — 요청 본문에 학번 키 자체가 없다
    expect(errors.studentId).toBeNull();
    expect(isProfileFormValid(errors)).toBe(true);
    expect(request).toEqual({ name: '합성 조교', department: '인공지능학부' });
  });

  it('프로필을 마치면 승인 대기 화면으로 간다', () => {
    // Given / When / Then — 남은 단계가 없어야 동선이 끝난다
    expect(onboardingPathFor('PENDING', 'complete')).toBe(
      '/onboarding/pending',
    );
  });
});

describe('새 관리자 가입 동선', () => {
  it('이름만으로 프로필을 마치고 학번도 학과도 묻지 않는다', () => {
    // Given — 관리자 역할은 관리자가 부여하므로 프로필 단계에서 이미 배정돼 있다
    const role: AppRole = 'ADMIN';
    const values = {
      name: '합성 관리자',
      studentId: '',
      departmentOption: '',
      otherDepartment: '',
    };

    // When
    const requirement = profileFieldRequirement(role);
    const errors = validateProfileForm(values, role);

    // Then
    expect(requirement).toEqual({ studentId: false, department: false });
    expect(errors.studentId).toBeNull();
    expect(errors.department).toBeNull();
    expect(toCompleteProfileRequest(values, role)).toEqual({
      name: '합성 관리자',
    });
  });
});
