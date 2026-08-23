import { MemberKind } from '@prisma/client';
import {
  effectiveProfileMemberKind,
  isCompleteUserProfile,
  isValidCompleteUserProfileFields,
  profileFieldRequirement,
} from './user-profile-policy';

// 관리자는 이 표에 없다 — `hasAdminAccess`는 회원 정체성과 독립이라 학생 관리자는
// 학생 기준으로, 교직원 관리자는 교직원 기준으로 프로필을 채운다.
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

// 소속은 두 유형 모두에게 필수다 — 계약 스키마의 `affiliationName`이 NOT NULL이다.
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
  // Given — 프런트 응답 파서가 isComplete=true 응답의 값 형식을 불변식으로 본다
  // When / Then
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
  // 완료 판정은 예전 형식 학번을 통과시키지만(`isStoredStudentId`) 이 판정은 아니다.
  // 여기서 정하는 것은 "이 값으로 **새 행을 만들어도 되는가**"이고, 예전 형식 값을
  // 새 행으로 옮기는 것은 기존 데이터를 손대는 결정이라 별도 승인 사항이다.
  expect(
    isValidCompleteUserProfileFields({
      name: '합성 사용자',
      studentId: '9'.repeat(9),
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

/**
 * 새 칸이 비어 있는 기존 사용자를 학생 기준으로 되돌리지 않는다. 마이그레이션이
 * backfill을 하지만, 그 사이에 들어온 요청도 살아 있는 요청을 근거로 답해야 한다.
 */
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
    // Given — 프로필을 입력하는 동안에는 프로필 행도 승인 요청도 없다(#569).
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
  // Given — 프로필 행이 만들어진 뒤에는 그 행이 정본이다.
  expect(
    effectiveProfileMemberKind({
      memberKind: MemberKind.STAFF,
      hasPendingStaffRequest: false,
      selectedMemberKind: MemberKind.STUDENT,
    }),
  ).toBe('STAFF');
});

/**
 * 회수된 교직원의 프로필은 **그대로 완료다** (#184).
 *
 * 회수는 `hasStaffAccess`와 요청 상태만 바꾸고 `selectedMemberKind`는 건드리지 않는다.
 * 그래서 프로필 행이 아직 없어도 판정 근거가 남아 있고, 그가 채워 둔 이름·학과는 회수 전과 똑같이
 * 완료로 읽힌다. 회수가 없앤 것은 권한이지 그 사람이 입력해 둔 값이 아니다.
 *
 * 이 한 줄이 두 가지를 동시에 지탱한다.
 *
 * 1. **두 화면이 같은 답을 낸다** — 여기가 거짓이 되면 한 글자도 바뀌지 않은 프로필이
 *    회수된 순간 "미완료"로 뜬다. 회수 시 `selectedMemberKind`까지 비우자는 안을 받지 않은
 *    이유다. 관리자 화면은 별도 projection이라 같은 근거를 따로 넘겨 줘야 하고, 그쪽은
 *    `admin-access-read.repository.ts`가 맡는다.
 * 2. **프로필 저장이 교직원 신청을 만들지 않는다 — 단, 이미 완료인 사람만 그렇다.**
 *    `patchMyProfile`은 프로필이 **미완료일 때만** `completeProfileIfUnchanged`
 *    (그 안에서 `requestStaffAccess`이 신청을 만든다)로 내려간다. 아래 프로필처럼
 *    교직원 기준으로 이미 완료면 그 갈래에 들어가지 않는다.
 *
 * ⚠ 2번을 "재신청 경로는 둘뿐"으로 넓혀 읽으면 안 된다. **미완료인 채로 회수된 사용자**
 * 에게는 세 번째 경로가 실제로 있다 — 그가 프로필을 마치면 그 저장이 곧 재신청이 된다.
 * 그 상태가 어떻게 생기고 왜 그 동작이 옳은지는 `users.repository.integration.spec.ts`의
 * `가입을 마치지 못한 채 회수된 사용자…` 검사가 근거와 함께 들고 있다.
 */
it('회수된 교직원의 프로필은 회수 뒤에도 완료로 읽힌다', () => {
  // Given: 회수 직후의 상태 — 아직 프로필 행이 없고 고른 유형만 남아 있다.
  // 학번은 교직원 필수가 아니라 애초에 없다.
  const revokedStaff = {
    id: 'synthetic-user',
    name: '합성 교직원',
    studentId: null,
    department: '인공지능학부',
    memberKind: null,
    hasPendingStaffRequest: false,
    selectedMemberKind: MemberKind.STAFF,
  };

  // Then
  expect(effectiveProfileMemberKind(revokedStaff)).toBe('STAFF');
  expect(isCompleteUserProfile(revokedStaff)).toBe(true);
  // 근거가 사라지면 가장 엄격한 학생 기준으로 되돌아가 같은 프로필이 미완료가 된다 —
  // 회수가 `selectedMemberKind`를 비우면 벌어지는 일이다.
  expect(
    isCompleteUserProfile({ ...revokedStaff, selectedMemberKind: null }),
  ).toBe(false);
});
