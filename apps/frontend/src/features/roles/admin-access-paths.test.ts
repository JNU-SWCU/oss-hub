import { describe, expect, it } from 'vitest';

import { accessDetailPath } from './admin-access-list-query';

describe('accessDetailPath — 작업공간별 표준 상세 주소를 만든다', () => {
  it('관리자 명부 상세는 /dashboard/users 바로 아래에 사용자 ID를 둔다', () => {
    expect(accessDetailPath('directory', 'user/42')).toBe(
      '/dashboard/users/user%2F42',
    );
  });

  it('가입 신청 상세는 기존 users 하위 주소를 유지한다', () => {
    expect(accessDetailPath('queue', 'user/42')).toBe(
      '/dashboard/applicants/users/user%2F42',
    );
  });
});
