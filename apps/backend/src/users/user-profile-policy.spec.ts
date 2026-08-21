import {
  isCompleteUserProfile,
  isStoredStudentId,
  isValidDepartment,
  isValidStudentId,
  isValidUserName,
  USER_NAME_MAX_LENGTH,
} from './user-profile-policy';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.enum';

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

/**
 * 형식이 좁아지기 전(#835, 6~10자리)에 저장된 학번을 가진 학생.
 *
 * 여기가 false가 되는 순간 세션의 `isProfileComplete`와 프로필 응답의 `isComplete`가
 * 함께 뒤집혀, 이미 가입을 마친 학생이 온보딩 마지막 단계로 되돌아간다. 학번은 바꿀
 * 수 없는 값이라(`USR_003`) 그 화면에서 빠져나갈 방법이 없다.
 */
it('예전 형식으로 저장된 학번도 완료로 판정한다', () => {
  expect(
    isCompleteUserProfile({
      id: 'synthetic-legacy-student-id',
      name: '합성 사용자',
      studentId: '9'.repeat(9),
      department: '인공지능학부',
      role: 'STUDENT',
    }),
  ).toBe(true);
});

/** 예외의 근거는 "예전 규칙으로 저장될 수 있었던 값"이지 "학번을 안 본다"가 아니다. */
it.each([['12'], ['1'.repeat(11)], ['12A456'], ['']])(
  '저장될 수 없었던 학번 %p은 완료로 보지 않는다',
  (studentId: string) => {
    expect(
      isCompleteUserProfile({
        id: 'synthetic-impossible-student-id',
        name: '합성 사용자',
        studentId,
        department: '인공지능학부',
        role: 'STUDENT',
      }),
    ).toBe(false);
  },
);

/**
 * Lockstep values with `profile-requirements.test.ts`.
 * Student IDs are synthetic local-unique fixtures, not roster data.
 */
const PROFILE_UNICODE_CONTRACT = {
  asciiName: 'Synthetic User',
  hangulName: '합성가',
  combiningMark: '\u0301',
  emoji: '😀',
  sixDigitId: '100001',
  legacyStoredIds: ['100001', '1000012', '1000012345'] as const,
  legacyTenDigitId: '1000012345',
  blank: '   \n\t  ',
  nonSixDigitIds: ['12A456', '10000', '1000012', '１２３４５６'] as const,
} as const;

const nfdCombiningE = `e${PROFILE_UNICODE_CONTRACT.combiningMark}`;

it.each([
  ['ASCII', PROFILE_UNICODE_CONTRACT.asciiName],
  ['Hangul NFC', PROFILE_UNICODE_CONTRACT.hangulName],
  ['Hangul NFD', PROFILE_UNICODE_CONTRACT.hangulName.normalize('NFD')],
  ['combining marks', nfdCombiningE.repeat(100)],
  ['emoji/surrogate pairs', PROFILE_UNICODE_CONTRACT.emoji.repeat(100)],
  ['NFD Hangul 100 syllables', '가'.repeat(100).normalize('NFD')],
] as const)(
  'accepts %s after NFC within 100 code points',
  (_label: string, name: string) => {
    expect(isValidUserName(name)).toBe(true);
    expect(isValidDepartment(name)).toBe(true);
  },
);

it('accepts six digits for new student IDs and keeps legacy 6-10 stored IDs complete', () => {
  expect(isValidStudentId(PROFILE_UNICODE_CONTRACT.sixDigitId)).toBe(true);
  for (const studentId of PROFILE_UNICODE_CONTRACT.legacyStoredIds) {
    expect(isStoredStudentId(studentId)).toBe(true);
    expect(
      isCompleteUserProfile({
        id: 'synthetic-legacy-complete',
        name: PROFILE_UNICODE_CONTRACT.hangulName,
        studentId,
        department: '인공지능학부',
        role: 'STUDENT',
      }),
    ).toBe(true);
  }
});

it('rejects blank names and affiliation after trim', () => {
  expect(isValidUserName(PROFILE_UNICODE_CONTRACT.blank)).toBe(false);
  expect(isValidDepartment(PROFILE_UNICODE_CONTRACT.blank)).toBe(false);
  expect(isValidUserName('')).toBe(false);
});

it('rejects 101 code points after NFC', () => {
  expect(isValidUserName(nfdCombiningE.repeat(101))).toBe(false);
  expect(isValidUserName('가'.repeat(101))).toBe(false);
  expect(isValidUserName(PROFILE_UNICODE_CONTRACT.emoji.repeat(101))).toBe(
    false,
  );
  expect(isValidDepartment('가'.repeat(101))).toBe(false);
});

it('maps duplicate student IDs to USR_004', () => {
  expect(UsersErrorCode.STUDENT_ID_TAKEN).toBe('USR_004');
  expect(USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_TAKEN].code).toBe(
    'USR_004',
  );
  expect(USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_TAKEN].status).toBe(409);
});

it('rejects non-six-digit new student IDs', () => {
  for (const studentId of PROFILE_UNICODE_CONTRACT.nonSixDigitIds) {
    expect(isValidStudentId(studentId)).toBe(false);
  }
  expect(isValidStudentId(PROFILE_UNICODE_CONTRACT.legacyTenDigitId)).toBe(
    false,
  );
});
