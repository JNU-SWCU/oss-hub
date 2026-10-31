import { JoinCodeSecretService } from '../platform/join-code-secret.service';

const joinCodeSecretService = new JoinCodeSecretService();

describe('join-code-digest', () => {
  describe('computeJoinCodeDigest', () => {
    it('기존 기본 secret 경로의 SHA-256 digest를 유지한다', () => {
      const digest = joinCodeSecretService.computeJoinCodeDigest(
        'SYNTHETIC-CODE',
        'synthetic-secret',
      );
      expect(digest).toBe(
        '59994207e573ae4398b370cab941aaf938045f134c64402d6b6501303cfa55ea',
      );
      expect(
        joinCodeSecretService.computeJoinCodeDigest(
          'SYNTHETIC-CODE',
          'synthetic-secret',
        ),
      ).toBe(digest);
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
    });

    it('참여코드나 secret이 다르면 digest가 달라진다', () => {
      const base = joinCodeSecretService.computeJoinCodeDigest(
        'SYNTHETIC-CODE',
        'secret-a',
      );
      expect(
        joinCodeSecretService.computeJoinCodeDigest('OTHER-CODE', 'secret-a'),
      ).not.toBe(base);
      expect(
        joinCodeSecretService.computeJoinCodeDigest(
          'SYNTHETIC-CODE',
          'secret-b',
        ),
      ).not.toBe(base);
    });
  });
});
