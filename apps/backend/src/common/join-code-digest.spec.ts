import {
  computeJoinCodeDigest,
  JoinCodeSecretError,
  resolveJoinCodeSecret,
} from './join-code-digest';

describe('resolveJoinCodeSecret', () => {
  it('설정된 TEAM_JOIN_CODE_SECRET을 반환한다', () => {
    // Given
    const env = { TEAM_JOIN_CODE_SECRET: 'synthetic-secret' };

    // When
    const secret = resolveJoinCodeSecret(env);

    // Then
    expect(secret).toBe('synthetic-secret');
  });

  it('개발·테스트에서는 결정적인 기본키를 반환한다', () => {
    // Given
    const env = {};

    // When
    const first = resolveJoinCodeSecret(env);
    const second = resolveJoinCodeSecret(env);

    // Then
    expect(first).toBe(second);
  });

  it('운영 환경에서는 secret 누락을 거부한다', () => {
    // Given
    const env = { NODE_ENV: 'production' };

    // When
    const resolve = () => resolveJoinCodeSecret(env);

    // Then
    expect(resolve).toThrow(JoinCodeSecretError);
  });
});

describe('computeJoinCodeDigest', () => {
  it('같은 참여코드와 secret에는 같은 SHA-256 digest를 만든다', () => {
    // Given
    const joinCode = 'SYNTHETIC-CODE';
    const secret = 'synthetic-secret';

    // When
    const first = computeJoinCodeDigest(joinCode, secret);
    const second = computeJoinCodeDigest(joinCode, secret);

    // Then
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('참여코드나 secret이 다르면 digest가 달라진다', () => {
    // Given
    const joinCode = 'SYNTHETIC-CODE';

    // When
    const base = computeJoinCodeDigest(joinCode, 'secret-a');
    const changedCode = computeJoinCodeDigest('OTHER-CODE', 'secret-a');
    const changedSecret = computeJoinCodeDigest(joinCode, 'secret-b');

    // Then
    expect(changedCode).not.toBe(base);
    expect(changedSecret).not.toBe(base);
  });
});
