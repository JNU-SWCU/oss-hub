import { loadTestRoleMap, parseTestRoleMap } from './test-role-map';

describe('test-role-map', () => {
  it('공백·빈 항목을 허용하며 "githubId:ROLE" 목록을 파싱한다', () => {
    const map = parseTestRoleMap(' 101:STAFF, 202:STUDENT ,303:ADMIN, ');
    expect(map.get(101n)).toBe('STAFF');
    expect(map.get(202n)).toBe('STUDENT');
    expect(map.get(303n)).toBe('ADMIN');
    expect(map.size).toBe(3);
  });

  it.each([
    ['알 수 없는 역할', '101:TEACHER'],
    ['숫자가 아닌 ID', 'abc:STAFF'],
    ['음수 ID', '-1:STAFF'],
    ['구분자 누락', '101STAFF'],
    ['소문자 역할', '101:staff'],
    ['20자리 초과 ID', `${'9'.repeat(20)}:STAFF`],
  ])('형식 위반은 오류: %s', (_label, raw) => {
    expect(() => parseTestRoleMap(raw)).toThrow('항목 형식');
  });

  it('중복 githubId는 오류다', () => {
    expect(() => parseTestRoleMap('101:STAFF,101:ADMIN')).toThrow('중복');
  });

  it('오류 메시지에 항목 값을 노출하지 않는다', () => {
    const secretLikeId = '306409032';
    expect(() => parseTestRoleMap(`${secretLikeId}:TEACHER`)).not.toThrow(
      secretLikeId,
    );
  });

  it('미설정(undefined·빈 문자열)이면 빈 맵이다', () => {
    expect(loadTestRoleMap(undefined, false).size).toBe(0);
    expect(loadTestRoleMap('', false).size).toBe(0);
    expect(loadTestRoleMap('', true).size).toBe(0);
  });

  it('production에서 설정이 존재하면 시작 시 실패한다 (fail-fast)', () => {
    expect(() => loadTestRoleMap('101:STAFF', true)).toThrow('운영 환경');
  });

  it('비운영에서는 설정이 정상 로드된다', () => {
    expect(loadTestRoleMap('101:STAFF', false).get(101n)).toBe('STAFF');
  });
});
