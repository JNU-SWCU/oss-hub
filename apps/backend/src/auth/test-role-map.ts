/**
 * 테스트 전용 역할 매핑 (Issue #65).
 * 변경 가능한 login이 아니라 GitHub의 불변 숫자 ID를 키로 쓰고, User에 영속화하지 않는다.
 * 형식 위반·중복 ID는 조용히 무시하지 않고 시작 시 오류로 낸다 — 오설정이 숨는 것을 막기 위함이다.
 */

export const TEST_ROLES = ['STAFF', 'STUDENT', 'ADMIN'] as const;
export type TestRole = (typeof TEST_ROLES)[number];
export type TestRoleMap = ReadonlyMap<bigint, TestRole>;

const ENTRY_RE = /^([0-9]{1,19}):(STAFF|STUDENT|ADMIN)$/;

/** "githubId:ROLE[,githubId:ROLE...]" 파싱. 항목 값은 오류 메시지에 노출하지 않는다. */
export function parseTestRoleMap(raw: string): TestRoleMap {
  const map = new Map<bigint, TestRole>();
  for (const piece of raw.split(',')) {
    const entry = piece.trim();
    if (!entry) {
      continue;
    }
    const match = ENTRY_RE.exec(entry);
    const idRaw = match?.[1];
    const role = match?.[2] as TestRole | undefined;
    if (!idRaw || !role) {
      throw new Error(
        'AUTH_TEST_ROLE_MAP 항목 형식은 "githubId:STAFF|STUDENT|ADMIN" 입니다.',
      );
    }
    const githubId = BigInt(idRaw);
    if (map.has(githubId)) {
      throw new Error('AUTH_TEST_ROLE_MAP에 중복된 githubId가 있습니다.');
    }
    map.set(githubId, role);
  }
  return map;
}

/** production에서는 설정 존재 자체를 거부한다 (fail-fast). 미설정이면 빈 맵. */
export function loadTestRoleMap(
  raw: string | undefined,
  isProduction: boolean,
): TestRoleMap {
  if (!raw) {
    return new Map();
  }
  if (isProduction) {
    throw new Error('AUTH_TEST_ROLE_MAP은 운영 환경에서 활성화할 수 없습니다.');
  }
  return parseTestRoleMap(raw);
}
