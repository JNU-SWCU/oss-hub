import { MemberKind } from '@prisma/client';
import { loginLandingUrl } from './login-landing';

describe('loginLandingUrl', () => {
  const frontendUrl = 'https://oss.example';
  const onboardingEntry = `${frontendUrl}/consent`;

  const UNSETTLED = {
    memberKind: null,
    hasStaffAccess: false,
    hasAdminAccess: false,
  } as const;

  const SETTLED_IDENTITIES = [
    ['STUDENT', { ...UNSETTLED, memberKind: MemberKind.STUDENT }],
    [
      'STAFF',
      { ...UNSETTLED, memberKind: MemberKind.STAFF, hasStaffAccess: true },
    ],
    ['ADMIN', { ...UNSETTLED, hasAdminAccess: true }],
    [
      'STUDENT-ADMIN',
      { ...UNSETTLED, memberKind: MemberKind.STUDENT, hasAdminAccess: true },
    ],
  ] as const;

  it.each(SETTLED_IDENTITIES)(
    '온보딩을 마친 %s 재로그인 사용자는 랜딩으로 보낸다',
    (_label, identity) => {
      expect(
        loginLandingUrl(frontendUrl, {
          user: { ...identity, isProfileComplete: true },
          isNew: false,
        }),
      ).toBe(frontendUrl);
    },
  );

  it('접근 권한이 없는 완료된 STAFF는 온보딩 입구로 돌아간다', () => {
    expect(
      loginLandingUrl(frontendUrl, {
        user: {
          memberKind: MemberKind.STAFF,
          hasStaffAccess: false,
          hasAdminAccess: false,
          isProfileComplete: true,
        },
        isNew: false,
      }),
    ).toBe(onboardingEntry);
  });

  it('확정된 사실이 하나도 없으면 온보딩 입구로 보낸다', () => {
    expect(
      loginLandingUrl(frontendUrl, {
        user: { ...UNSETTLED, isProfileComplete: false },
        isNew: false,
      }),
    ).toBe(onboardingEntry);
  });

  it('신규 가입자는 온보딩 입구로 보낸다', () => {
    expect(
      loginLandingUrl(frontendUrl, {
        user: { ...UNSETTLED, isProfileComplete: false },
        isNew: true,
      }),
    ).toBe(onboardingEntry);
  });

  it.each(SETTLED_IDENTITIES)(
    '초기 시드로 %s이 설정된 신규 가입자도 온보딩 입구를 거친다',
    (_label, identity) => {
      expect(
        loginLandingUrl(frontendUrl, {
          user: { ...identity, isProfileComplete: true },
          isNew: true,
        }),
      ).toBe(onboardingEntry);
    },
  );

  it.each(SETTLED_IDENTITIES)(
    '확정된 사실이 있어도 프로필이 미완료인 %s는 온보딩 입구로 보낸다',
    (_label, identity) => {
      expect(
        loginLandingUrl(frontendUrl, {
          user: { ...identity, isProfileComplete: false },
          isNew: false,
        }),
      ).toBe(onboardingEntry);
    },
  );

  it('frontendUrl 뒤에 경로만 붙이고 출처는 바꾸지 않는다', () => {
    expect(
      loginLandingUrl('https://other.example', {
        user: { ...UNSETTLED, isProfileComplete: false },
        isNew: false,
      }),
    ).toBe('https://other.example/consent');
  });
});
