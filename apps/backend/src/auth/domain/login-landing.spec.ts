import { Role } from '@prisma/client';
import { loginLandingUrl } from './login-landing';

describe('loginLandingUrl', () => {
  const frontendUrl = 'https://oss.example';

  it('역할이 확정된 사용자는 랜딩으로 보낸다', () => {
    expect(loginLandingUrl(frontendUrl, { role: Role.STUDENT })).toBe(
      frontendUrl,
    );
  });

  it.each([Role.STUDENT, Role.STAFF, Role.ADMIN])(
    '%s 역할도 랜딩으로 보낸다',
    (role) => {
      expect(loginLandingUrl(frontendUrl, { role })).toBe(frontendUrl);
    },
  );

  // 역할 선택이 온보딩의 마지막 단계이므로 role이 비어 있으면 어느 단계에서든
  // 중단된 상태다. 첫 로그인인지 재로그인인지와 무관하게 재개 지점으로 보낸다.
  it('역할이 비어 있으면 온보딩 입구로 보낸다', () => {
    expect(loginLandingUrl(frontendUrl, { role: null })).toBe(
      `${frontendUrl}/consent`,
    );
  });

  it('frontendUrl 뒤에 경로만 붙이고 출처는 바꾸지 않는다', () => {
    expect(loginLandingUrl('https://other.example', { role: null })).toBe(
      'https://other.example/consent',
    );
  });
});
