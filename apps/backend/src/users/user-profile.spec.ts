import { MemberKind } from '@prisma/client';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.error';
import { USER_NAME_MAX_LENGTH } from './profile-validation.config';
import { UserProfileService } from '../platform/user-profile.service';

const userProfileService = new UserProfileService();

it('astral Unicode characters count as one profile character', () => {
  const name = '😀'.repeat(51);

  const complete = userProfileService.isCompleteUserProfile({
    id: 'synthetic-astral-name',
    name,
    studentId: '153401',
    department: '인공지능학부',
  });

  expect(name.length).toBeGreaterThan(USER_NAME_MAX_LENGTH);
  expect(complete).toBe(true);
});

it('rejects a profile that exceeds the code-point limit', () => {
  const name = '😀'.repeat(USER_NAME_MAX_LENGTH + 1);

  const complete = userProfileService.isCompleteUserProfile({
    id: 'synthetic-astral-name-too-long',
    name,
    studentId: '153402',
    department: '인공지능학부',
  });

  expect(complete).toBe(false);
});

it('예전 형식으로 저장된 학번도 완료로 판정한다', () => {
  expect(
    userProfileService.isCompleteUserProfile({
      id: 'synthetic-legacy-student-id',
      name: '합성 사용자',
      studentId: '9'.repeat(9),
      department: '인공지능학부',
      memberKind: MemberKind.STUDENT,
    }),
  ).toBe(true);
});

it('이미 완료된 legacy 학생은 연락처가 없어도 완료로 유지한다', () => {
  expect(
    userProfileService.isCompleteUserProfile({
      id: 'synthetic-legacy-student-without-phone',
      name: '합성 사용자',
      studentId: '153401',
      department: '인공지능학부',
      phone: null,
      memberKind: MemberKind.STUDENT,
    }),
  ).toBe(true);
});

it.each([['12'], ['1'.repeat(11)], ['12A456'], ['']])(
  '저장될 수 없었던 학번 %p은 완료로 보지 않는다',
  (studentId: string) => {
    expect(
      userProfileService.isCompleteUserProfile({
        id: 'synthetic-impossible-student-id',
        name: '합성 사용자',
        studentId,
        department: '인공지능학부',
        memberKind: MemberKind.STUDENT,
      }),
    ).toBe(false);
  },
);

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
    expect(userProfileService.isValidUserName(name)).toBe(true);
    expect(userProfileService.isValidDepartment(name)).toBe(true);
  },
);

it('accepts six digits for new student IDs and keeps legacy 6-10 stored IDs complete', () => {
  expect(
    userProfileService.isValidStudentId(PROFILE_UNICODE_CONTRACT.sixDigitId),
  ).toBe(true);
  for (const studentId of PROFILE_UNICODE_CONTRACT.legacyStoredIds) {
    expect(userProfileService.isStoredStudentId(studentId)).toBe(true);
    expect(
      userProfileService.isCompleteUserProfile({
        id: 'synthetic-legacy-complete',
        name: PROFILE_UNICODE_CONTRACT.hangulName,
        studentId,
        department: '인공지능학부',
        memberKind: MemberKind.STUDENT,
      }),
    ).toBe(true);
  }
});

it('rejects blank names and affiliation after trim', () => {
  expect(
    userProfileService.isValidUserName(PROFILE_UNICODE_CONTRACT.blank),
  ).toBe(false);
  expect(
    userProfileService.isValidDepartment(PROFILE_UNICODE_CONTRACT.blank),
  ).toBe(false);
  expect(userProfileService.isValidUserName('')).toBe(false);
});

it('rejects 101 code points after NFC', () => {
  expect(userProfileService.isValidUserName(nfdCombiningE.repeat(101))).toBe(
    false,
  );
  expect(userProfileService.isValidUserName('가'.repeat(101))).toBe(false);
  expect(
    userProfileService.isValidUserName(
      PROFILE_UNICODE_CONTRACT.emoji.repeat(101),
    ),
  ).toBe(false);
  expect(userProfileService.isValidDepartment('가'.repeat(101))).toBe(false);
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
    expect(userProfileService.isValidStudentId(studentId)).toBe(false);
  }
  expect(
    userProfileService.isValidStudentId(
      PROFILE_UNICODE_CONTRACT.legacyTenDigitId,
    ),
  ).toBe(false);
});

it('accepts only raw 10-11 ASCII phone digits', () => {
  expect(userProfileService.isValidPhone('7'.repeat(10))).toBe(true);
  expect(userProfileService.isValidPhone('8'.repeat(11))).toBe(true);
  for (const phone of [
    '1'.repeat(9),
    '2'.repeat(12),
    `${'3'.repeat(3)} ${'4'.repeat(7)}`,
    `${'3'.repeat(3)}-${'4'.repeat(7)}`,
    `${'3'.repeat(3)}.${'4'.repeat(7)}`,
    `+${'5'.repeat(10)}`,
    `(${'6'.repeat(3)})${'7'.repeat(7)}`,
    `${'8'.repeat(7)}ABCD`,
    `０${'9'.repeat(9)}`,
  ]) {
    expect(userProfileService.isValidPhone(phone)).toBe(false);
  }
});
