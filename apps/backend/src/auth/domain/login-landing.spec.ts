import { loginLandingUrl } from './login-landing';

describe('loginLandingUrl', () => {
  const frontendUrl = 'https://oss.example';
  const onboardingEntry = `${frontendUrl}/consent`;

  it.each(['STUDENT', 'STAFF', 'ADMIN'])(
    '온보딩을 마친 %s 재로그인 사용자는 랜딩으로 보낸다',
    (role) => {
      expect(
        loginLandingUrl(frontendUrl, {
          user: { role, isProfileComplete: true },
          isNew: false,
        }),
      ).toBe(frontendUrl);
    },
  );

  // 역할 선택이 온보딩의 마지막 단계이므로 role이 비어 있으면 어느 단계에서든
  // 중단된 상태다. 첫 로그인인지 재로그인인지와 무관하게 재개 지점으로 보낸다.
  it('역할이 비어 있으면 온보딩 입구로 보낸다', () => {
    expect(
      loginLandingUrl(frontendUrl, {
        user: { role: null, isProfileComplete: false },
        isNew: false,
      }),
    ).toBe(onboardingEntry);
  });

  it('신규 가입자는 온보딩 입구로 보낸다', () => {
    expect(
      loginLandingUrl(frontendUrl, {
        user: { role: null, isProfileComplete: false },
        isNew: true,
      }),
    ).toBe(onboardingEntry);
  });

  // AUTH_INITIAL_ROLES는 계정 생성 시점에 역할을 채운다(역할별 검증 계정 등).
  // role만 보면 이 사용자가 동의·프로필 단계를 건너뛰게 되고, 동의는 개인정보
  // 경계이므로 신규 가입자는 role 유무와 무관하게 항상 입구를 거쳐야 한다.
  it.each(['STUDENT', 'STAFF', 'ADMIN'])(
    '초기 역할 %s이 설정된 신규 가입자도 온보딩 입구를 거친다',
    (role) => {
      expect(
        loginLandingUrl(frontendUrl, {
          user: { role, isProfileComplete: true },
          isNew: true,
        }),
      ).toBe(onboardingEntry);
    },
  );

  // 순서를 역할 → 프로필로 바꾼 뒤로는 역할이 있으면서 프로필이 비어 있는 상태가
  // 정상적으로 존재한다. 그 사용자를 랜딩으로 떨어뜨리면 남은 단계로 돌아갈 길이 없다.
  it.each(['STUDENT', 'STAFF', 'ADMIN'])(
    '역할이 있어도 프로필이 미완료인 %s는 온보딩 입구로 보낸다',
    (role) => {
      expect(
        loginLandingUrl(frontendUrl, {
          user: { role, isProfileComplete: false },
          isNew: false,
        }),
      ).toBe(onboardingEntry);
    },
  );

  it('frontendUrl 뒤에 경로만 붙이고 출처는 바꾸지 않는다', () => {
    expect(
      loginLandingUrl('https://other.example', {
        user: { role: null, isProfileComplete: false },
        isNew: false,
      }),
    ).toBe('https://other.example/consent');
  });
});
