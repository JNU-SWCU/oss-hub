import type { Role } from '@prisma/client';
import {
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
] as const)('%s 역할에서 학번 없는 프로필의 완료 여부는 %s', (role, expected) => {
  expect(
    isCompleteUserProfile({
      id: 'synthetic-no-student-id',
      name: '합성 사용자',
      studentId: null,
      department: '인공지능학부',
      role,
    }),
  ).toBe(expected);
});

it.each([
  ['STUDENT', false],
  ['STAFF', false],
  ['ADMIN', true],
] as const)('%s 역할에서 학과 없는 프로필의 완료 여부는 %s', (role, expected) => {
  expect(
    isCompleteUserProfile({
      id: 'synthetic-no-department',
      name: '합성 사용자',
      studentId: '153403',
      department: null,
      role,
    }),
  ).toBe(expected);
});

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
