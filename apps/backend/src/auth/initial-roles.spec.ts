import { parseInitialRoles } from './initial-roles';

describe('parseInitialRoles', () => {
  // 설정 어휘 한 단어가 canonical 세 사실로 펼쳐진다. **ADMIN은 회원 유형을 남기지
  // 않고 교직원 접근도 켜지 않는다** — 관리자 권한은 정체성과 독립이고, 시드가 유형을
  // 지어내면 그 사람이 스스로 고칠 수 없는 거짓이 박힌다.
  it('유효한 githubId와 설정 값을 canonical 사실로 펼친다', () => {
    expect(parseInitialRoles('101:ADMIN,202:STAFF,303:STUDENT')).toEqual(
      new Map([
        [
          101n,
          { memberKind: null, hasStaffAccess: false, hasAdminAccess: true },
        ],
        [
          202n,
          { memberKind: 'STAFF', hasStaffAccess: true, hasAdminAccess: false },
        ],
        [
          303n,
          {
            memberKind: 'STUDENT',
            hasStaffAccess: false,
            hasAdminAccess: false,
          },
        ],
      ]),
    );
  });

  it('항목 경계의 공백은 허용한다', () => {
    expect(parseInitialRoles(' 101:STAFF , 202:STUDENT ')).toEqual(
      new Map([
        [
          101n,
          { memberKind: 'STAFF', hasStaffAccess: true, hasAdminAccess: false },
        ],
        [
          202n,
          {
            memberKind: 'STUDENT',
            hasStaffAccess: false,
            hasAdminAccess: false,
          },
        ],
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
