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

  it('비공백 secret의 원문(앞뒤 공백 포함)을 그대로 반환한다', () => {
    // Given — trim 하지 않아 기존 HMAC digest 계약이 유지된다
    const env = { TEAM_JOIN_CODE_SECRET: '  padded-secret  ' };

    // When
    const secret = resolveJoinCodeSecret(env);

    // Then
    expect(secret).toBe('  padded-secret  ');
  });

  it.each([
    ['absent', {}],
    ['empty', { TEAM_JOIN_CODE_SECRET: '' }],
    ['whitespace', { TEAM_JOIN_CODE_SECRET: '   ' }],
    ['tabs-newlines', { TEAM_JOIN_CODE_SECRET: '\t\n  \t' }],
    ['development-absent', { NODE_ENV: 'development' }],
    ['production-absent', { NODE_ENV: 'production' }],
    [
      'development-whitespace',
      { NODE_ENV: 'development', TEAM_JOIN_CODE_SECRET: '  ' },
    ],
    [
      'production-whitespace',
      { NODE_ENV: 'production', TEAM_JOIN_CODE_SECRET: '\t' },
    ],
  ])('TEAM_JOIN_CODE_SECRET 공백/누락을 거부한다 (%s)', (_label, env) => {
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
