import type {
  AdminAccessDetail,
  AdminAccessFacetCounts,
  AdminAccessHistory,
  AdminAccessListItem,
} from '@/features/roles/admin-access-api';

/**
 * 관리자 접근(`/admin/access`) 화면의 로컬 검토 픽스처.
 *
 * 이 화면은 예전의 사용자 목록·역할 변경·교직원 요청 판정이 하나로 합쳐진
 * 자리다(PR04C~04H). 합쳐지면서 API도 `users/access`·`users/{id}/access`·
 * `users/{id}/access/history` 로 바뀌었는데 픽스처가 따라오지 않아, 로컬 검토
 * 에서는 목록도 상세도 전부 기본 404(`LFX_404`)로 떨어졌다. 상세 화면은 404를
 * `ROL_010`일 때만 "사용자를 찾을 수 없습니다"로 읽으므로(admin-access-detail-api.ts
 * 의 `isNotFound`), `LFX_404`는 일반 실패로 분류돼 "관리자 접근 상세를 불러오지
 * 못했습니다" 오류로 보였다. 제품이 아니라 픽스처가 비어 있던 것이다.
 *
 * `admin-access-api.ts`의 파서는 필드 하나만 어긋나도 `AdminAccessResponseError`
 * 를 던지므로, 아래 상수는 그 타입을 `satisfies`로 직접 붙들어 둔다 — 계약이
 * 바뀌면 픽스처가 런타임이 아니라 타입 검사에서 먼저 깨진다.
 */

/** 검토자가 로그인해 있는 관리자 본인. 자기 자신은 역할을 못 바꾼다(`isSelf`). */
const SELF_ID = 'synthetic-admin-self';

/**
 * 상세 화면의 대표 대상. `/admin/access/users/synthetic-admin-target` 주소를
 * 직접 열어도 열려야 하는 사용자다 — 대기 중인 요청·반려 이력·로그인 이력을
 * 모두 갖고 있어 상세의 모든 구획이 비지 않는다.
 */
const TARGET_ID = 'synthetic-admin-target';

const LIST_ITEMS = [
  {
    id: SELF_ID,
    githubLogin: 'synthetic-admin-self',
    name: '합성 관리자',
    role: 'ADMIN',
    accountStatus: 'ACTIVE',
    isSelf: true,
    isProfileComplete: true,
    pendingRequest: null,
    lastLoginAt: '2026-07-31T00:10:00.000Z',
  },
  {
    id: TARGET_ID,
    githubLogin: 'synthetic-target',
    name: '합성 교직원 후보',
    role: 'STUDENT',
    accountStatus: 'ACTIVE',
    isSelf: false,
    isProfileComplete: true,
    pendingRequest: {
      id: 'synthetic-access-request-01',
      status: 'PENDING',
      createdAt: '2026-07-29T02:00:00.000Z',
    },
    lastLoginAt: '2026-07-30T23:40:00.000Z',
  },
  {
    id: 'synthetic-admin-staff',
    githubLogin: 'synthetic-staff',
    name: '합성 교직원',
    role: 'STAFF',
    accountStatus: 'ACTIVE',
    isSelf: false,
    isProfileComplete: true,
    pendingRequest: null,
    lastLoginAt: '2026-07-28T05:00:00.000Z',
  },
  {
    // 프로필 미완료 + 역할 미지정 — 상세의 "자격 없음" 분기를 보여 준다.
    id: 'synthetic-admin-unassigned',
    githubLogin: 'synthetic-unassigned',
    name: null,
    role: null,
    accountStatus: 'ACTIVE',
    isSelf: false,
    isProfileComplete: false,
    pendingRequest: null,
    lastLoginAt: null,
  },
  {
    // 비활성 계정 — 상세의 차단 사유가 프로필보다 먼저 걸리는 분기.
    id: 'synthetic-admin-deactivated',
    githubLogin: 'synthetic-deactivated',
    name: '합성 비활성 사용자',
    role: 'STUDENT',
    accountStatus: 'DEACTIVATED',
    isSelf: false,
    isProfileComplete: true,
    pendingRequest: null,
    lastLoginAt: '2026-06-02T01:00:00.000Z',
  },
] as const satisfies readonly AdminAccessListItem[];

/** 목록 항목별 프로필. 상세(`AdminAccessDetail`)에만 실린다. */
const PROFILES: Readonly<Record<string, AdminAccessDetail['profile']>> = {
  [SELF_ID]: {
    name: '합성 관리자',
    studentId: '202000',
    department: '빅데이터융합학과',
    isComplete: true,
  },
  [TARGET_ID]: {
    name: '합성 교직원 후보',
    studentId: '202601',
    department: '인공지능학부',
    isComplete: true,
  },
  'synthetic-admin-staff': {
    name: '합성 교직원',
    studentId: null,
    department: '소프트웨어공학과',
    isComplete: true,
  },
  'synthetic-admin-unassigned': {
    name: null,
    studentId: null,
    department: null,
    isComplete: false,
  },
  'synthetic-admin-deactivated': {
    name: '합성 비활성 사용자',
    studentId: '202411',
    department: '전자공학부',
    isComplete: true,
  },
};

/**
 * 이력은 대상 사용자별로만 다르게 준다. 목록에 있는 나머지는 빈 이력이라
 * 상세의 "이력이 없습니다" 분기도 검토 대상에 들어온다.
 */
const HISTORIES: Readonly<
  Record<
    string,
    {
      readonly staffAccessRequests: AdminAccessHistory['staffAccessRequests']['items'];
      readonly loginHistory: AdminAccessHistory['loginHistory']['items'];
    }
  >
> = {
  [TARGET_ID]: {
    staffAccessRequests: [
      {
        id: 'synthetic-access-request-01',
        status: 'PENDING',
        rejectionReason: null,
        decidedAt: null,
        decidedBy: null,
        createdAt: '2026-07-29T02:00:00.000Z',
      },
      {
        id: 'synthetic-access-request-00',
        status: 'REJECTED',
        rejectionReason: '담당 프로그램 소속을 확인하지 못했습니다.',
        decidedAt: '2026-06-14T04:30:00.000Z',
        decidedBy: 'synthetic-admin-self',
        createdAt: '2026-06-12T01:00:00.000Z',
      },
    ],
    loginHistory: [
      {
        id: 'synthetic-access-login-02',
        event: 'LOGIN',
        provider: 'github',
        success: true,
        loginAt: '2026-07-30T23:40:00.000Z',
      },
      {
        id: 'synthetic-access-login-01',
        event: 'LOGIN',
        provider: 'github',
        success: false,
        loginAt: '2026-07-30T23:38:00.000Z',
      },
    ],
  },
  'synthetic-admin-staff': {
    staffAccessRequests: [
      {
        id: 'synthetic-access-request-02',
        status: 'APPROVED',
        rejectionReason: null,
        decidedAt: '2026-05-20T02:00:00.000Z',
        decidedBy: 'synthetic-admin-self',
        createdAt: '2026-05-19T02:00:00.000Z',
      },
    ],
    loginHistory: [
      {
        id: 'synthetic-access-login-03',
        event: 'LOGIN',
        provider: 'github',
        success: true,
        loginAt: '2026-07-28T05:00:00.000Z',
      },
    ],
  },
};

/**
 * 가입 시각 — 화면 응답에는 **넣지 않는다.** backend 는 `User.createdAt` 으로
 * 정렬하지만 목록 DTO 는 그 값을 내려주지 않기 때문이다(`AdminAccessListItem`).
 * 픽스처가 이 값을 갖고 있지 않으면 `sort=createdAt` 이 이름순으로 조용히
 * 떨어져, 정렬을 바꿔도 순서가 그대로라 검토자가 정렬 결함을 볼 수 없다.
 * 이름순·최근 로그인순과 **다른 순서**가 나오도록 일부러 어긋나게 뒀다.
 */
const CREATED_AT_BY_ID: Readonly<Record<string, string>> = {
  [SELF_ID]: '2026-03-02T00:00:00.000Z',
  [TARGET_ID]: '2026-01-15T00:00:00.000Z',
  'synthetic-admin-staff': '2026-05-20T00:00:00.000Z',
  'synthetic-admin-unassigned': '2026-06-11T00:00:00.000Z',
  'synthetic-admin-deactivated': '2026-02-08T00:00:00.000Z',
};

export function adminAccessFixtureCreatedAt(userId: string): string | null {
  return CREATED_AT_BY_ID[userId] ?? null;
}

export function adminAccessFixtureItems(): readonly AdminAccessListItem[] {
  return LIST_ITEMS;
}

export function findAdminAccessFixtureDetail(
  userId: string,
): AdminAccessDetail | null {
  const item = LIST_ITEMS.find((candidate) => candidate.id === userId);
  if (!item) return null;
  const profile = PROFILES[item.id];
  if (!profile) return null;
  return { ...item, profile };
}

export function adminAccessFixtureHistory(
  userId: string,
  limits: {
    readonly staffAccessRequestPage: number;
    readonly staffAccessRequestLimit: number;
    readonly loginPage: number;
    readonly loginLimit: number;
  },
): AdminAccessHistory {
  const source = HISTORIES[userId] ?? {
    staffAccessRequests: [],
    loginHistory: [],
  };
  return {
    staffAccessRequests: {
      items: paginate(
        source.staffAccessRequests,
        limits.staffAccessRequestPage,
        limits.staffAccessRequestLimit,
      ),
      page: limits.staffAccessRequestPage,
      limit: limits.staffAccessRequestLimit,
      total: source.staffAccessRequests.length,
    },
    loginHistory: {
      items: paginate(source.loginHistory, limits.loginPage, limits.loginLimit),
      page: limits.loginPage,
      limit: limits.loginLimit,
      total: source.loginHistory.length,
    },
  };
}

function paginate<T>(
  items: readonly T[],
  page: number,
  limit: number,
): readonly T[] {
  const start = (page - 1) * limit;
  return items.slice(start, start + limit);
}

/**
 * 패싯은 **필터를 적용하기 전 전체 집합**에서 센다 — 화면이 "이 필터를 고르면
 * 몇 건인지"를 보여 주는 값이라, 지금 적용된 필터로 먼저 걸러 버리면 고르지
 * 않은 칸이 전부 0이 된다.
 */
export function adminAccessFixtureFacets(
  items: readonly AdminAccessListItem[],
): AdminAccessFacetCounts {
  const countRole = (role: AdminAccessListItem['role']) =>
    items.filter((item) => item.role === role).length;
  return {
    roles: {
      unassigned: countRole(null),
      student: countRole('STUDENT'),
      staff: countRole('STAFF'),
      admin: countRole('ADMIN'),
    },
    accountStatuses: {
      active: items.filter((item) => item.accountStatus === 'ACTIVE').length,
      deactivated: items.filter((item) => item.accountStatus === 'DEACTIVATED')
        .length,
    },
    pendingRequests: {
      none: items.filter((item) => item.pendingRequest === null).length,
      pending: items.filter((item) => item.pendingRequest !== null).length,
    },
  };
}
