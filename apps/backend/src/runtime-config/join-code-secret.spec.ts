import { JoinCodeSecretError, resolveJoinCodeSecret } from './join-code-secret';

describe('resolveJoinCodeSecret', () => {
  it('설정된 TEAM_JOIN_CODE_SECRET을 반환한다', () => {
    const env = { TEAM_JOIN_CODE_SECRET: 'synthetic-secret' };

    const secret = resolveJoinCodeSecret(env);

    expect(secret).toBe('synthetic-secret');
  });

  it('비공백 secret의 원문(앞뒤 공백 포함)을 그대로 반환한다', () => {
    const env = { TEAM_JOIN_CODE_SECRET: '  padded-secret  ' };

    const secret = resolveJoinCodeSecret(env);

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
    const resolve = () => resolveJoinCodeSecret(env);

    expect(resolve).toThrow(JoinCodeSecretError);
  });
});
