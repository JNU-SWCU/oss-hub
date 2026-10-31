import { NestFactory } from '@nestjs/core';
import { bootstrap } from './main';
import { AuthConfig } from './platform/auth.config';
import { loadRuntimeConfig } from './platform/runtime-config.config';

describe('HTTP bootstrap', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('인증 환경변수가 없으면 listen 전에 같은 오류로 실패한다', async () => {
    const listen = jest.fn();
    jest.spyOn(NestFactory, 'create').mockResolvedValue({
      get: () => new AuthConfig(loadRuntimeConfig({})),
      listen,
    } as never);

    await expect(bootstrap()).rejects.toThrow('SESSION_SECRET이 필수입니다.');
    expect(listen).not.toHaveBeenCalled();
  });
});
