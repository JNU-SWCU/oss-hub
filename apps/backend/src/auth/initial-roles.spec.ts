import { parseInitialRoles } from './initial-roles';

describe('parseInitialRoles', () => {
  it('유효한 githubId와 역할을 파싱한다', () => {
    expect(parseInitialRoles('101:ADMIN,202:STAFF,303:STUDENT')).toEqual(
      new Map([
        [101n, 'ADMIN'],
        [202n, 'STAFF'],
        [303n, 'STUDENT'],
      ]),
    );
  });

  it('항목 경계의 공백은 허용한다', () => {
    expect(parseInitialRoles(' 101:STAFF , 202:STUDENT ')).toEqual(
      new Map([
        [101n, 'STAFF'],
        [202n, 'STUDENT'],
      ]),
    );
  });

  it.each(['0:ADMIN', '-1:ADMIN', '+1:ADMIN', '1 01:ADMIN'])(
    'canonical positive decimal githubId가 아니면 거부한다',
    (raw) => {
      expect(() => parseInitialRoles(raw)).toThrow('AUTH_INITIAL_ROLES');
    },
  );

  it('알 수 없는 역할을 거부한다', () => {
    expect(() => parseInitialRoles('101:OWNER')).toThrow('AUTH_INITIAL_ROLES');
  });

  it('중복 githubId를 거부한다', () => {
    expect(() => parseInitialRoles('101:ADMIN,101:STAFF')).toThrow('중복');
  });

  it.each([undefined, '', '   '])('빈 값은 빈 맵이다', (raw) => {
    expect(parseInitialRoles(raw)).toEqual(new Map());
  });
});
