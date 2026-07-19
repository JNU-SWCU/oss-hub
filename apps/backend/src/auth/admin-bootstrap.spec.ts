import { Role } from '@prisma/client';
import { resolveBootstrapRole } from './admin-bootstrap';

describe('resolveBootstrapRole (Issue #109 관리자 부트스트랩)', () => {
  it.each(['GoBeromsu', 'goberomsu', 'GOBEROMSU', 'Lumiere001', 'lumiere001'])(
    '부트스트랩 대상 login(%s)은 대소문자와 무관하게 ADMIN을 반환한다',
    (login) => {
      expect(resolveBootstrapRole(login)).toBe(Role.ADMIN);
    },
  );

  it('부트스트랩 대상이 아닌 login은 null을 반환한다', () => {
    expect(resolveBootstrapRole('synthetic-random-login')).toBeNull();
  });
});
