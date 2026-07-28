import { Role } from '@prisma/client';

export type InitialRoleMap = ReadonlyMap<bigint, Role>;

const ENTRY_RE = /^([1-9][0-9]*):(ADMIN|STAFF|STUDENT)$/;

/** "githubId:ROLE[,githubId:ROLE...]" 형식의 초기 역할 설정을 파싱한다. */
export function parseInitialRoles(raw: string | undefined): InitialRoleMap {
  if (!raw?.trim()) {
    return new Map();
  }

  const map = new Map<bigint, Role>();
  for (const piece of raw.split(',')) {
    const entry = piece.trim();
    const match = ENTRY_RE.exec(entry);
    const idRaw = match?.[1];
    const role = match?.[2] as Role | undefined;
    if (!idRaw || !role) {
      throw new Error(
        'AUTH_INITIAL_ROLES 항목 형식은 "githubId:ADMIN|STAFF|STUDENT" 입니다.',
      );
    }

    const githubId = BigInt(idRaw);
    if (map.has(githubId)) {
      throw new Error('AUTH_INITIAL_ROLES에 중복된 githubId가 있습니다.');
    }
    map.set(githubId, role);
  }
  return map;
}
