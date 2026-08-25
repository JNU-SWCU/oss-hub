import type { ExecutionContext } from '@nestjs/common';
import { DomainException } from '../common/error-code';
import { AuthConfig } from './auth.config';
import { OriginGuard } from './origin.guard';

const allowedOrigin = 'https://oss.example';

function contextWithHeaders(
  headers: Readonly<Record<string, string | undefined>>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

function guard(): OriginGuard {
  return new OriginGuard({ allowedOrigin } as AuthConfig);
}

function expectForbidden(
  headers: Readonly<Record<string, string | undefined>>,
): void {
  expect(() => guard().canActivate(contextWithHeaders(headers))).toThrow(
    DomainException,
  );
}

describe('OriginGuard', () => {
  it('Origin과 Referer가 모두 없으면 거부한다', () => {
    expectForbidden({});
  });

  it('형식이 깨진 Referer를 거부한다', () => {
    expectForbidden({ referer: 'not-a-url' });
  });

  it('다른 origin의 Referer를 거부한다', () => {
    expectForbidden({ referer: 'https://attacker.example/account' });
  });

  it('opaque Origin null을 거부한다', () => {
    expectForbidden({ origin: 'null' });
  });

  it('설정과 정확히 같은 Origin은 허용한다', () => {
    expect(
      guard().canActivate(contextWithHeaders({ origin: allowedOrigin })),
    ).toBe(true);
  });

  it('Origin이 없으면 설정과 같은 origin의 Referer를 허용한다', () => {
    expect(
      guard().canActivate(
        contextWithHeaders({
          referer: `${allowedOrigin}/account?tab=security#sessions`,
        }),
      ),
    ).toBe(true);
  });
});
