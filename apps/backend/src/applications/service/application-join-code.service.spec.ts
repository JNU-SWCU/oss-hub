import { computeJoinCodeDigest } from '../../programs/domain/join-code-digest';
import { JoinCodeSecretError } from '../../runtime-config/join-code-secret';
import { ApplicationJoinCodeService } from './application-join-code.service';

describe('ApplicationJoinCodeService', () => {
  it.each([undefined, '', '   '])(
    'TEAM_JOIN_CODE_SECRET이 %p이면 생성 시점에 실패한다',
    (secret) => {
      expect(
        () => new ApplicationJoinCodeService({ TEAM_JOIN_CODE_SECRET: secret }),
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
    const codes = Array.from({ length: 20 }, () => service.generateJoinCode());

    for (const code of codes) {
      expect(code).toMatch(/^[A-Z0-9_-]{8}$/);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });
});
