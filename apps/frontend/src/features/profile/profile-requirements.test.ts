import { describe, expect, it } from 'vitest';
import {
  isConsistentCompleteProfile,
  isDepartmentRequiredForProfile,
  isProfileComplete,
  profileFieldRequirement,
  type ProfileRole,
} from './profile-requirements';

const STUDENT_ID = '1'.repeat(6);

function fields(overrides: {
  readonly name?: string;
  readonly studentId?: string | null;
  readonly department?: string | null;
}) {
  return {
    name: '합성 사용자',
    studentId: STUDENT_ID,
    department: '인공지능학부',
    ...overrides,
  };
}

describe('profile field requirements', () => {
  it.each([
    ['STUDENT', true, true],
    ['STAFF', false, true],
    ['ADMIN', false, false],
  ] as const)('%s의 필수 항목을 정의한다', (role, studentId, department) => {
    expect(profileFieldRequirement(role)).toEqual({ studentId, department });
  });

  it('역할 미배정(null)은 학생 기준을 따른다 — 역할 선택이 프로필 다음 단계다', () => {
    expect(profileFieldRequirement(null)).toEqual(
      profileFieldRequirement('STUDENT'),
    );
  });
});

describe('role-aware profile completion', () => {
  it('학생은 이름·학번·학과가 모두 있어야 완성이다', () => {
    expect(isProfileComplete(fields({}), 'STUDENT')).toBe(true);
    expect(isProfileComplete(fields({ studentId: null }), 'STUDENT')).toBe(
      false,
    );
    expect(isProfileComplete(fields({ department: null }), 'STUDENT')).toBe(
      false,
    );
  });

  it('교직원은 학번이 없어도 완성이다', () => {
    expect(isProfileComplete(fields({ studentId: null }), 'STAFF')).toBe(true);
    expect(
      isProfileComplete(fields({ studentId: null, department: null }), 'STAFF'),
    ).toBe(false);
  });

  it('관리자는 학번·학과가 없어도 이름만 있으면 완성이다', () => {
    expect(
      isProfileComplete(fields({ studentId: null, department: null }), 'ADMIN'),
    ).toBe(true);
  });

  it.each(['STUDENT', 'STAFF', 'ADMIN'] as const)(
    '%s도 이름이 비면 완성이 아니다',
    (role: ProfileRole) => {
      expect(isProfileComplete(fields({ name: '   ' }), role)).toBe(false);
    },
  );

  it('요구되는 항목의 형식은 계속 검사한다', () => {
    expect(isProfileComplete(fields({ studentId: '12A456' }), 'STUDENT')).toBe(
      false,
    );
    expect(isProfileComplete(fields({ department: '   ' }), 'STAFF')).toBe(
      false,
    );
    // 요구되지 않는 항목의 잘못된 값은 완성 판정을 막지 않는다.
    expect(isProfileComplete(fields({ studentId: '12A456' }), 'STAFF')).toBe(
      true,
    );
  });
});

describe('server isComplete consistency', () => {
  it('값이 없는 항목은 역할 차이일 수 있으므로 모순으로 보지 않는다', () => {
    expect(
      isConsistentCompleteProfile(
        fields({ studentId: null, department: null }),
      ),
    ).toBe(true);
  });

  it('이름이 비었거나 실려 온 값의 형식이 틀리면 모순이다', () => {
    expect(isConsistentCompleteProfile(fields({ name: '   ' }))).toBe(false);
    expect(isConsistentCompleteProfile(fields({ studentId: '' }))).toBe(false);
    expect(isConsistentCompleteProfile(fields({ studentId: '12A456' }))).toBe(
      false,
    );
    expect(isConsistentCompleteProfile(fields({ department: '   ' }))).toBe(
      false,
    );
  });
});

describe('학번을 함께 저장할 때의 학과', () => {
  it('학과가 필수가 아닌 역할도 학번을 적으면 학과가 필요해진다', () => {
    // Given / When / Then — 학번이 유일성 제약 아래 저장되는 행이 학과를 요구한다
    expect(isDepartmentRequiredForProfile('ADMIN', '')).toBe(false);
    expect(isDepartmentRequiredForProfile('ADMIN', '   ')).toBe(false);
    expect(isDepartmentRequiredForProfile('ADMIN', STUDENT_ID)).toBe(true);
  });

  it('학과가 원래 필수인 역할은 학번과 무관하게 그대로다', () => {
    for (const role of ['STUDENT', 'STAFF'] as const) {
      expect(isDepartmentRequiredForProfile(role, '')).toBe(true);
      expect(isDepartmentRequiredForProfile(role, STUDENT_ID)).toBe(true);
    }
  });
});
