import { MemberKind } from '@prisma/client';

/**
 * 부트스트랩 시드가 한 계정에 매기는 canonical 사실.
 *
 * 예전에는 배타적 `Role` 하나였다. 회원 정체성과 접근 권한이 갈라진 뒤로는 그 값
 * 하나로 세 사실을 다 담을 수 없어, 파싱 시점에 여기로 펼친다.
 *
 * | 설정 값 | memberKind | hasStaffAccess | hasAdminAccess |
 * | --- | --- | --- | --- |
 * | STUDENT | STUDENT | false | false |
 * | STAFF | STAFF | true | false |
 * | ADMIN | null | false | true |
 *
 * ADMIN이 회원 유형을 남기지 않는 것이 요점이다. 관리자 권한은 정체성과 독립이라
 * (`hasAdminAccess`), 시드가 학생인지 교직원인지 임의로 정하면 그 사람이 나중에
 * 스스로 고칠 수 없는 거짓 사실이 박힌다. ADMIN도 `hasStaffAccess`를 얻지 않는다 —
 * 관리자가 곧 교직원은 아니다.
 */
export type InitialAccountSeed = {
  readonly memberKind: MemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
};

export type InitialAccountSeedMap = ReadonlyMap<bigint, InitialAccountSeed>;

const ENTRY_RE = /^([1-9][0-9]*):(ADMIN|STAFF|STUDENT)$/;

const SEED_BY_SETTING: Record<'ADMIN' | 'STAFF' | 'STUDENT', InitialAccountSeed> =
  {
    STUDENT: {
      memberKind: MemberKind.STUDENT,
      hasStaffAccess: false,
      hasAdminAccess: false,
    },
    STAFF: {
      memberKind: MemberKind.STAFF,
      hasStaffAccess: true,
      hasAdminAccess: false,
    },
    ADMIN: {
      memberKind: null,
      hasStaffAccess: false,
      hasAdminAccess: true,
    },
  };

/**
 * "githubId:ROLE[,githubId:ROLE...]" 형식의 초기 시드 설정을 파싱한다.
 *
 * 설정 키(`AUTH_INITIAL_ROLES`)와 값 어휘(ADMIN/STAFF/STUDENT)는 운영 환경 계약이라
 * 그대로 둔다 — 이름만 바꾸면 돌아가는 배포의 env 파일이 조용히 무시된다.
 */
export function parseInitialRoles(
  raw: string | undefined,
): InitialAccountSeedMap {
  if (!raw?.trim()) {
    return new Map();
  }

  const map = new Map<bigint, InitialAccountSeed>();
  for (const piece of raw.split(',')) {
    const entry = piece.trim();
    const match = ENTRY_RE.exec(entry);
    const idRaw = match?.[1];
    const setting = match?.[2] as keyof typeof SEED_BY_SETTING | undefined;
    if (!idRaw || !setting) {
      throw new Error(
        'AUTH_INITIAL_ROLES 항목 형식은 "githubId:ADMIN|STAFF|STUDENT" 입니다.',
      );
    }

    const githubId = BigInt(idRaw);
    if (map.has(githubId)) {
      throw new Error('AUTH_INITIAL_ROLES에 중복된 githubId가 있습니다.');
    }
    map.set(githubId, SEED_BY_SETTING[setting]);
  }
  return map;
}

/**
 * 설정 어휘 한 단어를 canonical 사실로 펼친다 — `parseInitialRoles`가 쓰는 것과 같은 표.
 *
 * 테스트와 다른 호출부가 "ADMIN 시드"를 한 단어로 말하면서도 저장은 canonical 칸으로만
 * 하도록 이 통로를 export한다.
 */
export function initialAccountSeed(
  setting: 'ADMIN' | 'STAFF' | 'STUDENT',
): InitialAccountSeed {
  return SEED_BY_SETTING[setting];
}
