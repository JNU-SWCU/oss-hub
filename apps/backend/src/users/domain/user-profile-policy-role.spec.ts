import { MemberKind } from '@prisma/client';
import {
  effectiveProfileMemberKind,
  isCompleteUserProfile,
  isValidCompleteUserProfileFields,
  profileFieldRequirement,
} from './user-profile-policy';

it.each([
  ['STUDENT', { studentId: true, department: true }],
  ['STAFF', { studentId: false, department: true }],
] as const)('%s 회원 유형의 필수 항목 표', (memberKind, expected) => {
  expect(profileFieldRequirement(memberKind)).toEqual(expected);
});

it.each([[null], [undefined]] as const)(
  '회원 유형이 %s이면 학생 기준으로 판정한다',
  (memberKind) => {
    expect(profileFieldRequirement(memberKind)).toEqual(
      profileFieldRequirement('STUDENT'),
    );
  },
);

it.each([
  ['STUDENT', false],
  ['STAFF', true],
] as const)(
  '%s 회원 유형에서 학번 없는 프로필의 완료 여부는 %s',
  (memberKind, expected) => {
    expect(
      isCompleteUserProfile({
        id: 'synthetic-no-student-id',
        name: '합성 사용자',
        studentId: null,
        department: '인공지능학부',
        memberKind,
      }),
    ).toBe(expected);
  },
);

it.each([
  ['STUDENT', false],
  ['STAFF', false],
] as const)(
  '%s 회원 유형에서 소속 없는 프로필의 완료 여부는 %s',
  (memberKind, expected) => {
    expect(
      isCompleteUserProfile({
        id: 'synthetic-no-department',
        name: '합성 사용자',
        studentId: '153403',
        department: null,
        memberKind,
      }),
    ).toBe(expected);
  },
);

it('필수가 아니어도 실려 있는 값의 형식은 검사한다', () => {
  expect(
    isCompleteUserProfile({
      id: 'synthetic-malformed-optional',
      name: '합성 사용자',
      studentId: '12A456',
      department: '인공지능학부',
      memberKind: MemberKind.STAFF,
      hasStaffAccess: true,
    }),
  ).toBe(false);
});

it('이름이 없으면 어떤 회원 유형에서도 미완료다', () => {
  for (const memberKind of ['STUDENT', 'STAFF', null] as const) {
    expect(
      isCompleteUserProfile({
        id: 'synthetic-no-name',
        name: null,
        studentId: '153404',
        department: '인공지능학부',
        memberKind,
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

  expect(
    isValidCompleteUserProfileFields({
      name: '합성 사용자',
      studentId: '9'.repeat(9),
      department: '인공지능학부',
    }),
  ).toBe(false);
});

it('승인 대기 교직원은 학번이 없어도 완료다', () => {
  expect(
    isCompleteUserProfile({
      id: 'synthetic-pending-staff',
      name: '합성 교직원',
      studentId: null,
      department: '인공지능학부',
      memberKind: null,
      hasPendingStaffRequest: true,
    }),
  ).toBe(true);
});

it('승인 대기 교직원의 학번은 필수가 아니다', () => {
  expect(
    profileFieldRequirement(
      effectiveProfileMemberKind({
        memberKind: null,
        hasPendingStaffRequest: true,
      }),
    ),
  ).toEqual({ studentId: false, department: true });
});

it('고른 역할이 비어 있어도 살아 있는 요청이 교직원 기준을 지킨다', () => {
  expect(
    effectiveProfileMemberKind({
      memberKind: null,
      hasPendingStaffRequest: true,
    }),
  ).toBe('STAFF');
});

it.each([
  ['STUDENT', { studentId: true, department: true }],
  ['STAFF', { studentId: false, department: true }],
] as const)(
  '확정 전에는 고른 회원 유형(%s)이 필수 항목을 정한다',
  (selectedMemberKind, expected) => {
    expect(
      profileFieldRequirement(
        effectiveProfileMemberKind({
          memberKind: null,
          hasPendingStaffRequest: false,
          selectedMemberKind,
        }),
      ),
    ).toEqual(expected);
  },
);

it('확정된 회원 유형이 고른 유형을 이긴다', () => {
  expect(
    effectiveProfileMemberKind({
      memberKind: MemberKind.STAFF,
      hasPendingStaffRequest: false,
      selectedMemberKind: MemberKind.STUDENT,
    }),
  ).toBe('STAFF');
});

it('회수된 교직원의 프로필은 회수 뒤에도 완료로 읽힌다', () => {
  const revokedStaff = {
    id: 'synthetic-user',
    name: '합성 교직원',
    studentId: null,
    department: '인공지능학부',
    memberKind: null,
    hasPendingStaffRequest: false,
    selectedMemberKind: MemberKind.STAFF,
  };

  expect(effectiveProfileMemberKind(revokedStaff)).toBe('STAFF');
  expect(isCompleteUserProfile(revokedStaff)).toBe(true);

  expect(
    isCompleteUserProfile({ ...revokedStaff, selectedMemberKind: null }),
  ).toBe(false);
});
