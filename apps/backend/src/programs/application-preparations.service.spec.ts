import { computeJoinCodeDigest } from './application-decision.policy';
import { JoinCodeSecretError } from '../platform/join-code-secret.config';
import {
  ApplicationJoinCodeService,
  ApplicationPreparationsService,
} from './application-preparations.service';
import type { ApplicationPreparationsRepository } from './application-preparations.repository';

describe('ApplicationPreparationsService.get', () => {
  function serviceWith(found: unknown) {
    const get = jest.fn().mockResolvedValue(found);
    const repository = {
      findActor: jest.fn().mockResolvedValue('user-1'),
      get,
    } as unknown as ApplicationPreparationsRepository;
    return { service: new ApplicationPreparationsService(repository), get };
  }

  it('준비가 없으면 없음(null)을 컨트롤러에 넘긴다', async () => {
    const { service, get } = serviceWith(null);

    await expect(service.get(4242n, 'program-1')).resolves.toBeNull();
    expect(get).toHaveBeenCalledWith('program-1', 'user-1');
  });

  it('준비가 있으면 조회 결과를 그대로 넘긴다', async () => {
    const preparation = { id: 'team-1' };
    const { service } = serviceWith(preparation);

    await expect(service.get(4242n, 'program-1')).resolves.toBe(preparation);
  });
});

describe('application-join-code.service', () => {
  describe('ApplicationJoinCodeService', () => {
    it.each([undefined, '', '   '])(
      'TEAM_JOIN_CODE_SECRET이 %p이면 생성 시점에 실패한다',
      (secret) => {
        expect(
          () =>
            new ApplicationJoinCodeService({ TEAM_JOIN_CODE_SECRET: secret }),
        ).toThrow(JoinCodeSecretError);
      },
    );

    it('설정된 secret으로 참여코드 digest를 만든다', () => {
      const service = new ApplicationJoinCodeService({
        TEAM_JOIN_CODE_SECRET: 'synthetic-secret-a',
      });

      expect(service.computeJoinCodeDigest('SYNTHETIC-CODE')).toBe(
        computeJoinCodeDigest('SYNTHETIC-CODE', 'synthetic-secret-a'),
      );
      expect(service.computeJoinCodeDigest('SYNTHETIC-CODE')).not.toBe(
        computeJoinCodeDigest('SYNTHETIC-CODE', 'synthetic-secret-b'),
      );
    });

    it('8자 대문자 base64url 참여코드를 매번 새로 만든다', () => {
      const service = new ApplicationJoinCodeService({
        TEAM_JOIN_CODE_SECRET: 'synthetic-secret-a',
      });
      const codes = Array.from({ length: 20 }, () =>
        service.generateJoinCode(),
      );

      for (const code of codes) {
        expect(code).toMatch(/^[A-Z0-9_-]{8}$/);
      }
      expect(new Set(codes).size).toBe(codes.length);
    });
  });
});
