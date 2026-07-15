import {
  createFlowState,
  decodeFlowCookie,
  encodeFlowCookie,
  isSameState,
  toCodeChallenge,
} from './oauth-flow';

describe('oauth-flow', () => {
  it('생성된 state·verifier는 각각 43자 base64url이다', () => {
    const flow = createFlowState();
    expect(flow.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(flow.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(flow.state).not.toBe(flow.verifier);
  });

  it('encode → decode 왕복이 보존된다', () => {
    const flow = createFlowState();
    expect(decodeFlowCookie(encodeFlowCookie(flow))).toEqual(flow);
  });

  it.each([
    ['undefined', undefined],
    ['빈 문자열', ''],
    ['segment 1개', 'a'.repeat(43)],
    ['segment 3개', `${'a'.repeat(43)}.${'b'.repeat(43)}.${'c'.repeat(43)}`],
    ['길이 42', `${'a'.repeat(42)}.${'b'.repeat(43)}`],
    ['길이 44', `${'a'.repeat(44)}.${'b'.repeat(43)}`],
    ['base64url 밖 문자(+)', `${'a'.repeat(42)}+.${'b'.repeat(43)}`],
    ['padding(=) 포함', `${'a'.repeat(42)}=.${'b'.repeat(43)}`],
  ])('형식 위반 쿠키는 null: %s', (_label, value) => {
    expect(decodeFlowCookie(value)).toBeNull();
  });

  it('state 비교: 동일하면 true, 다르거나 길이가 다르면 false', () => {
    const { state } = createFlowState();
    const mutated = `${state.slice(0, 42)}${state[42] === 'A' ? 'B' : 'A'}`;
    expect(mutated).toHaveLength(43);
    expect(mutated).not.toBe(state);
    expect(isSameState(state, state)).toBe(true);
    expect(isSameState(state, mutated)).toBe(false);
    expect(isSameState(state, state.slice(0, 42))).toBe(false);
  });

  it('code_challenge는 RFC 7636 S256 테스트 벡터와 일치한다', () => {
    // RFC 7636 Appendix B
    expect(toCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});
