import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';

import type { AdminAccessProfile } from './admin-access-api';
import {
  ADMIN_PROFILE_DEPARTMENT_MAX_LENGTH,
  ADMIN_PROFILE_NAME_MAX_LENGTH,
  adminProfileUpdateErrorMessage,
  createAdminProfileEditValues,
  isAdminProfileEditValid,
  isValidAdminProfileDepartment,
  isValidAdminProfileName,
  isValidAdminProfileStudentId,
  resolveAdminProfileDepartment,
  toAdminProfileUpdateCommand,
  validateAdminProfileEdit,
} from './admin-profile-edit-policy';

/**
 * `admin-access-profile-section.tsx`가 쓰는 검증·값 변환 규칙을 직접
 * 검증한다. `features/profile/profile-requirements.ts`·`profile-state.ts`와
 * 형식 규칙(이름 100자, 학과 100자, 학번 숫자 6~10자리)은 같지만, 관리자
 * 경로만의 차이 — 이미 저장된 학번/학과도 고칠 수 있지만 비워둘 수는
 * 없다 — 를 중심으로 다룬다.
 */

function profile(
  overrides: Partial<AdminAccessProfile> = {},
): AdminAccessProfile {
  return {
    name: '합성 사용자',
    studentId: '260001',
    department: '소프트웨어공학과',
    isComplete: true,
    ...overrides,
  };
}

describe('형식 검증', () => {
  it('이름은 빈 문자열이거나 100자를 넘으면 무효다', () => {
    expect(isValidAdminProfileName('합성')).toBe(true);
    expect(isValidAdminProfileName('')).toBe(false);
    expect(
      isValidAdminProfileName('a'.repeat(ADMIN_PROFILE_NAME_MAX_LENGTH)),
    ).toBe(true);
    expect(
      isValidAdminProfileName('a'.repeat(ADMIN_PROFILE_NAME_MAX_LENGTH + 1)),
    ).toBe(false);
  });

  it('학번은 숫자 6~10자리만 유효하다', () => {
    expect(isValidAdminProfileStudentId('202601')).toBe(true);
    expect(isValidAdminProfileStudentId('2026010001')).toBe(true);
    expect(isValidAdminProfileStudentId('20260')).toBe(false);
    expect(isValidAdminProfileStudentId('20260100011')).toBe(false);
    expect(isValidAdminProfileStudentId('2026-01')).toBe(false);
  });

  it('학과는 빈 문자열이거나 100자를 넘으면 무효다', () => {
    expect(isValidAdminProfileDepartment('소프트웨어공학과')).toBe(true);
    expect(isValidAdminProfileDepartment('')).toBe(false);
    expect(
      isValidAdminProfileDepartment(
        'a'.repeat(ADMIN_PROFILE_DEPARTMENT_MAX_LENGTH + 1),
      ),
    ).toBe(false);
  });
});

describe('createAdminProfileEditValues — 서버 프로필을 편집 초기값으로 변환', () => {
  it('목록에 있는 학과는 departmentOption에 그대로 담는다', () => {
    const values = createAdminProfileEditValues(
      profile({ department: '소프트웨어공학과' }),
    );
    expect(values.departmentOption).toBe('소프트웨어공학과');
    expect(values.otherDepartment).toBe('');
  });

  it('목록에 없는 학과는 기타(직접 입력)로 풀어 otherDepartment에 담는다', () => {
    const values = createAdminProfileEditValues(
      profile({ department: '아주 낯선 학과' }),
    );
    expect(values.otherDepartment).toBe('아주 낯선 학과');
    expect(resolveAdminProfileDepartment(values)).toBe('아주 낯선 학과');
  });

  it('학과가 없으면 빈 selection으로 초기화한다', () => {
    const values = createAdminProfileEditValues(profile({ department: null }));
    expect(values.departmentOption).toBe('');
    expect(values.otherDepartment).toBe('');
  });
});

describe('validateAdminProfileEdit — 백엔드가 null로 지울 수 없는 필드를 미리 막는다', () => {
  it('이미 저장된 학번을 빈 칸으로 만들면 에러다', () => {
    const original = profile({ studentId: '260001' });
    const values = createAdminProfileEditValues(profile({ studentId: '' }));
    const errors = validateAdminProfileEdit(values, original);
    expect(errors.studentId).toBe('이미 저장된 학번은 비워둘 수 없습니다.');
  });

  it('아직 학번이 없던 사용자는 빈 칸으로 두어도 통과한다', () => {
    const original = profile({ studentId: null, department: null });
    const values = createAdminProfileEditValues(original);
    const errors = validateAdminProfileEdit(values, original);
    expect(errors.studentId).toBeNull();
  });

  it('이미 저장된 학과를 빈 칸으로 만들면 에러다', () => {
    const original = profile({ department: '소프트웨어공학과' });
    const values = {
      ...createAdminProfileEditValues(original),
      departmentOption: '',
      otherDepartment: '',
    };
    const errors = validateAdminProfileEdit(values, original);
    expect(errors.department).toBe('이미 저장된 학과는 비워둘 수 없습니다.');
  });

  it('학번을 새로 채우면서 학과는 비워두면 에러다', () => {
    const original = profile({ studentId: null, department: null });
    const values = {
      ...createAdminProfileEditValues(original),
      studentId: '260002',
      departmentOption: '',
      otherDepartment: '',
    };
    const errors = validateAdminProfileEdit(values, original);
    expect(errors.department).toBe(
      '학번을 저장하려면 학과도 함께 입력해 주세요.',
    );
  });

  it('형식이 잘못된 학번은 형식 에러를 낸다', () => {
    const original = profile();
    const values = {
      ...createAdminProfileEditValues(original),
      studentId: 'abc',
    };
    const errors = validateAdminProfileEdit(values, original);
    expect(errors.studentId).toBe('학번은 숫자 6~10자리로 입력해 주세요.');
  });

  it('모든 값이 유효하면 세 필드 모두 null이다', () => {
    const original = profile();
    const values = createAdminProfileEditValues(original);
    const errors = validateAdminProfileEdit(values, original);
    expect(isAdminProfileEditValid(errors)).toBe(true);
  });
});

describe('toAdminProfileUpdateCommand — 바뀐 필드만 담는다', () => {
  it('검증에 실패하면 null을 반환한다', () => {
    const original = profile();
    const values = { ...createAdminProfileEditValues(original), name: '' };
    expect(toAdminProfileUpdateCommand(values, original)).toBeNull();
  });

  it('아무것도 바뀌지 않았으면 빈 객체를 반환한다', () => {
    const original = profile();
    const values = createAdminProfileEditValues(original);
    expect(toAdminProfileUpdateCommand(values, original)).toEqual({});
  });

  it('학번만 바뀌면 command에 studentId만 담는다(관리자는 이미 저장된 학번도 고칠 수 있다)', () => {
    const original = profile({ studentId: '260001' });
    const values = {
      ...createAdminProfileEditValues(original),
      studentId: '260002',
    };
    expect(toAdminProfileUpdateCommand(values, original)).toEqual({
      studentId: '260002',
    });
  });

  it('이름·학번·학과가 모두 바뀌면 세 필드 모두 담는다', () => {
    const original = profile({
      name: '이전 이름',
      studentId: '260001',
      department: '소프트웨어공학과',
    });
    const values = {
      name: '새 이름',
      studentId: '260002',
      departmentOption: '컴퓨터공학과',
      otherDepartment: '',
    };
    expect(toAdminProfileUpdateCommand(values, original)).toEqual({
      name: '새 이름',
      studentId: '260002',
      department: '컴퓨터공학과',
    });
  });
});

describe('adminProfileUpdateErrorMessage', () => {
  it('ApiError는 problem.detail을 그대로 보여준다(백엔드가 이미 구분되는 한국어를 준다)', () => {
    const error = new ApiError({
      type: 'about:blank',
      title: 'CONFLICT',
      status: 409,
      detail: '이미 다른 사용자가 사용 중인 학번이라 수정할 수 없습니다.',
      instance: '/users/target/profile',
      code: 'USR_008',
    });
    expect(adminProfileUpdateErrorMessage(error)).toBe(
      '이미 다른 사용자가 사용 중인 학번이라 수정할 수 없습니다.',
    );
  });

  it('ApiError가 아닌 실패는 일반 문구로 대신한다', () => {
    expect(adminProfileUpdateErrorMessage(new Error('network down'))).toBe(
      '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    );
  });
});
