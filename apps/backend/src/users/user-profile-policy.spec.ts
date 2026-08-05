import type { Role } from '@prisma/client';
import {
  effectiveProfileRole,
  isCompleteUserProfile,
  isValidCompleteUserProfileFields,
  profileFieldRequirement,
  USER_NAME_MAX_LENGTH,
} from './user-profile-policy';

it('astral Unicode characters count as one profile character', () => {
  // Given
  const name = '😀'.repeat(51);

  // When
  const complete = isCompleteUserProfile({
    id: 'synthetic-astral-name',
    name,
    studentId: '153401',
    department: '인공지능학부',
  });

  // Then
  expect(name.length).toBeGreaterThan(USER_NAME_MAX_LENGTH);
  expect(complete).toBe(true);
});

it('rejects a profile that exceeds the code-point limit', () => {
  // Given
  const name = '😀'.repeat(USER_NAME_MAX_LENGTH + 1);

  // When
  const complete = isCompleteUserProfile({
    id: 'synthetic-astral-name-too-long',
    name,
    studentId: '153402',
    department: '인공지능학부',
  });

  // Then
  expect(complete).toBe(false);
});

it.each([
  ['STUDENT', { studentId: true, department: true }],
  ['STAFF', { studentId: false, department: true }],
  ['ADMIN', { studentId: false, department: false }],
] as const)('%s 역할의 필수 항목 표', (role: Role, expected) => {
  expect(profileFieldRequirement(role)).toEqual(expected);
});

it.each([[null], [undefined]] as const)(
  '역할이 %s이면 학생 기준으로 판정한다',
  (role) => {
    expect(profileFieldRequirement(role)).toEqual(
      profileFieldRequirement('STUDENT'),
    );
  },
);

it.each([
  ['STUDENT', false],
  ['STAFF', true],
  ['ADMIN', true],
] as const)(
  '%s 역할에서 학번 없는 프로필의 완료 여부는 %s',
  (role, expected) => {
    expect(
      isCompleteUserProfile({
        id: 'synthetic-no-student-id',
        name: '합성 사용자',
        studentId: null,
        department: '인공지능학부',
        role,
      }),
    ).toBe(expected);
  },
);

it.each([
  ['STUDENT', false],
  ['STAFF', false],
  ['ADMIN', true],
] as const)(
  '%s 역할에서 학과 없는 프로필의 완료 여부는 %s',
  (role, expected) => {
    expect(
      isCompleteUserProfile({
        id: 'synthetic-no-department',
        name: '합성 사용자',
        studentId: '153403',
        department: null,
        role,
      }),
    ).toBe(expected);
  },
);

it('필수가 아니어도 실려 있는 값의 형식은 검사한다', () => {
  // Given — 프런트 응답 파서가 isComplete=true 응답의 값 형식을 불변식으로 본다
  // When / Then
  expect(
    isCompleteUserProfile({
      id: 'synthetic-malformed-optional',
      name: '합성 사용자',
      studentId: '12A456',
      department: '인공지능학부',
      role: 'STAFF',
    }),
  ).toBe(false);
});

it('이름이 없으면 어떤 역할에서도 미완료다', () => {
  for (const role of ['STUDENT', 'STAFF', 'ADMIN', null] as const) {
    expect(
      isCompleteUserProfile({
        id: 'synthetic-no-name',
        name: null,
        studentId: '153404',
        department: '인공지능학부',
        role,
      }),
    ).toBe(false);
  }
});

it('backfill이 쓰는 엄격 판정은 세 항목이 모두 유효할 때만 참이다', () => {
  expect(
    isValidCompleteUserProfileFields({
      name: '합성 사용자',
      studentId: '153405',
      department: '인공지능학부',
    }),
  ).toBe(true);
  expect(
    isValidCompleteUserProfileFields({
      name: '합성 사용자',
      studentId: '12A456',
      department: '인공지능학부',
    }),
  ).toBe(false);
});

/**
 * #569 회귀 검사 ③ — **승인 대기 교직원을 깨뜨리지 않는다.**
 *
 * 확정을 `가입 마치기`로 미루면서 판정 근거에 `selectedRole`이 하나 늘었다. 그
 * 우선순위가 어긋나면 프로필까지 마치고 승인을 기다리는 교직원이 학생 기준으로
 * 판정돼 미완료가 되고, 프로필 화면에서 학번이 '선택'에서 '필수'로 바뀐다 —
 * 교직원 가입이 통째로 막힌다.
 */
it('승인 대기 교직원은 학번이 없어도 완료다', () => {
  expect(
    isCompleteUserProfile({
      id: 'synthetic-pending-staff',
      name: '합성 교직원',
      studentId: null,
      department: '인공지능학부',
      role: null,
      hasPendingStaffRequest: true,
    }),
  ).toBe(true);
});

it('승인 대기 교직원의 학번은 필수가 아니다', () => {
  expect(
    profileFieldRequirement(
      effectiveProfileRole({ role: null, hasPendingStaffRequest: true }),
    ),
  ).toEqual({ studentId: false, department: true });
});

/**
 * 새 칸이 비어 있는 기존 사용자를 학생 기준으로 되돌리지 않는다. 마이그레이션이
 * backfill을 하지만, 그 사이에 들어온 요청도 살아 있는 요청을 근거로 답해야 한다.
 */
it('고른 역할이 비어 있어도 살아 있는 요청이 교직원 기준을 지킨다', () => {
  expect(
    effectiveProfileRole({
      role: null,
      hasPendingStaffRequest: true,
      selectedRole: null,
    }),
  ).toBe('STAFF');
});

it.each([
  ['STUDENT', { studentId: true, department: true }],
  ['STAFF', { studentId: false, department: true }],
] as const)(
  '확정 전에는 고른 역할(%s)이 필수 항목을 정한다',
  (selectedRole, expected) => {
    // Given — 프로필을 입력하는 동안에는 role도 승인 요청도 없다(#569).
    expect(
      profileFieldRequirement(
        effectiveProfileRole({
          role: null,
          hasPendingStaffRequest: false,
          selectedRole,
        }),
      ),
    ).toEqual(expected);
  },
);

it('배정된 역할이 고른 역할을 이긴다', () => {
  // Given — 관리자로 시드된 계정이 예전에 학생을 골라 뒀더라도 관리자다.
  expect(
    effectiveProfileRole({
      role: 'ADMIN',
      hasPendingStaffRequest: false,
      selectedRole: 'STUDENT',
    }),
  ).toBe('ADMIN');
});

/**
 * 회수된 교직원의 프로필은 **그대로 완료다** (#184).
 *
 * 회수는 `User.role`과 요청 상태만 바꾸고 `selectedRole`은 건드리지 않는다. 그래서
 * 확정 역할이 비어도 판정 근거가 남아 있고, 그가 채워 둔 이름·학과는 회수 전과 똑같이
 * 완료로 읽힌다. 회수가 없앤 것은 권한이지 그 사람이 입력해 둔 값이 아니다.
 *
 * 이 한 줄이 두 가지를 동시에 지탱한다.
 *
 * 1. **관리자 목록의 표시** — 여기가 거짓이 되면 한 글자도 바뀌지 않은 프로필이 회수된
 *    순간 "미완료"로 뜬다. 회수 시 `selectedRole`까지 비우자는 안을 받지 않은 이유다.
 * 2. **프로필 저장이 교직원 신청을 만들지 못한다** — `patchMyProfile`은 프로필이
 *    **미완료일 때만** `completeProfileIfUnchanged`(그 안에서 `confirmSelectedRole`이
 *    신청을 만든다)로 내려간다. 회수된 교직원은 이미 완료라 그 갈래에 들어가지 않고,
 *    프로필을 고쳐도 신청이 생기지 않는다. 재신청은 역할 선택 화면과 재요청 API에서만
 *    일어난다.
 */
it('회수된 교직원의 프로필은 회수 뒤에도 완료로 읽힌다', () => {
  // Given: 회수 직후의 상태 — 확정 역할은 비었고 고른 역할만 남아 있다. 학번은 교직원
  // 필수가 아니라 애초에 없다.
  const revokedStaff = {
    id: 'synthetic-user',
    name: '합성 교직원',
    studentId: null,
    department: '인공지능학부',
    role: null,
    hasPendingStaffRequest: false,
    selectedRole: 'STAFF' as Role,
  };

  // Then
  expect(effectiveProfileRole(revokedStaff)).toBe('STAFF');
  expect(isCompleteUserProfile(revokedStaff)).toBe(true);
  // 근거가 사라지면 가장 엄격한 학생 기준으로 되돌아가 같은 프로필이 미완료가 된다 —
  // 회수가 `selectedRole`을 비우면 벌어지는 일이다.
  expect(isCompleteUserProfile({ ...revokedStaff, selectedRole: null })).toBe(
    false,
  );
});
