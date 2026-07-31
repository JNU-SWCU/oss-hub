import type {
  PublicProfile,
  PublicProfileCategory,
  PublicProfileRepository,
} from '@/features/profile/public-profile-types';
import type { UserProfile } from '@/features/profile/types';
import type { MyRepositoryResponseItem } from '@/features/repositories/types';
import type {
  RoleRequest,
  RoleSelection,
  RoleSelectionResult,
} from '@/features/roles/types';
import type { LocalReviewFixtureId } from '../fixture-contract';
import {
  bodyBoolean,
  bodyEnum,
  bodyString,
  json,
  matchGet,
  notFound,
  redirect,
  unauthorized,
  type LocalReviewContext,
  type LocalReviewHandler,
  type LocalReviewResponsePlan,
} from '../handler-kit';

/**
 * 계정·온보딩·설정 도메인의 로컬 검토 응답.
 * 담당 경로: `users/me/*`, `consents/*`, `role-requests/me`, `onboarding/*`,
 * `auth/github`, `auth/logout`, `repositories/me`, `users/{id}/public-profile`.
 *
 * 데이터는 화면에서 합성임이 드러나야 한다 — 실제 인물·실제 GitHub 계정은 쓰지 않는다.
 */

/** 응답 계약은 파서가 파생시키는 라벨(`modeLabel`·`publishedLabel`)을 포함하지 않는다. */
type PublicProfileApiRepository = Omit<
  PublicProfileRepository,
  'modeLabel' | 'publishedLabel'
>;

type PublicProfileApiResponse = Omit<PublicProfile, 'repositories'> & {
  readonly repositories: readonly PublicProfileApiRepository[];
};

type PublicProfileRepositoryInput = {
  readonly repositoryId: string;
  readonly programId: string;
  readonly programName: string;
  readonly category: PublicProfileCategory;
  readonly applicationMode: 'PERSONAL' | 'TEAM';
  readonly displayName: string;
  readonly repositoryName: string;
  readonly publishedAt: string;
};

/**
 * 공개 프로필의 저장소 항목. 파서(`features/profile/public-profile-api.ts`)가
 * `githubUrl === https://github.com/JNU-SWCU/{repositoryName}`,
 * `detailUrl === /archive/{repositoryId}`, `publishedAt`은 `toISOString()` 형식만
 * 통과시키므로 그대로 맞춘다. 저장소 id는 공개 아카이브 픽스처와 같은 값을 써야
 * 프로필 → 아카이브 상세 이동이 끊기지 않는다.
 */
function publicProfileRepository(
  input: PublicProfileRepositoryInput,
): PublicProfileApiRepository {
  return {
    repositoryId: input.repositoryId,
    programId: input.programId,
    programName: input.programName,
    category: input.category,
    applicationMode: input.applicationMode,
    displayName: input.displayName,
    repositoryName: input.repositoryName,
    githubUrl: `https://github.com/JNU-SWCU/${input.repositoryName}`,
    publishedAt: input.publishedAt,
    detailUrl: `/archive/${input.repositoryId}`,
  };
}

const CAPSTONE_PROFILE_REPOSITORY = publicProfileRepository({
  repositoryId: 'synthetic-repo-capstone',
  programId: 'program-capstone',
  programName: '합성 캡스톤 2026',
  category: 'CAPSTONE',
  applicationMode: 'TEAM',
  displayName: '합성 캡스톤 팀 저장소',
  repositoryName: 'synthetic-capstone-archive',
  publishedAt: '2026-06-20T00:00:00.000Z',
});

const CONTEST_PROFILE_REPOSITORY = publicProfileRepository({
  repositoryId: 'synthetic-repo-contest',
  programId: 'program-oss-contest',
  programName: '합성 OSS 경진대회',
  category: 'OSS_CONTEST',
  applicationMode: 'TEAM',
  displayName: '합성 경진대회 팀 저장소',
  repositoryName: 'synthetic-contest-archive',
  publishedAt: '2026-05-12T00:00:00.000Z',
});

const BASIC_PROFILE_REPOSITORY = publicProfileRepository({
  repositoryId: 'synthetic-repo-basic',
  programId: 'program-basic-study',
  programName: '합성 기초 오픈소스 스터디',
  category: 'BASIC',
  applicationMode: 'PERSONAL',
  displayName: '합성 개인 실습 저장소',
  repositoryName: 'synthetic-basic-archive',
  publishedAt: '2026-04-02T00:00:00.000Z',
});

/**
 * 공개 프로필 픽스처. 공개 아카이브 상세의 기여자 목록(`synthetic-user-01`~`04`)과
 * 같은 id를 쓴다. `synthetic-user-05`는 게시된 저장소가 하나도 없는 빈 상태를
 * 검토하기 위한 항목이다.
 */
export const PUBLIC_PROFILE_FIXTURES: Readonly<
  Record<string, PublicProfileApiResponse>
> = {
  'synthetic-user-01': {
    userId: 'synthetic-user-01',
    githubNickname: 'synthetic-contributor-01',
    avatarUrl: null,
    repositories: [CAPSTONE_PROFILE_REPOSITORY, CONTEST_PROFILE_REPOSITORY],
  },
  'synthetic-user-02': {
    userId: 'synthetic-user-02',
    githubNickname: 'synthetic-contributor-02',
    avatarUrl: null,
    repositories: [CAPSTONE_PROFILE_REPOSITORY],
  },
  'synthetic-user-03': {
    userId: 'synthetic-user-03',
    githubNickname: 'synthetic-contributor-03',
    avatarUrl: null,
    repositories: [CONTEST_PROFILE_REPOSITORY],
  },
  'synthetic-user-04': {
    userId: 'synthetic-user-04',
    githubNickname: 'synthetic-contributor-04',
    avatarUrl: null,
    repositories: [BASIC_PROFILE_REPOSITORY],
  },
  'synthetic-user-05': {
    userId: 'synthetic-user-05',
    githubNickname: 'synthetic-contributor-05',
    avatarUrl: null,
    repositories: [],
  },
};

/**
 * `/my-repos` 목록. 파서가 `SUCCEEDED`가 아닌 항목은 저장소 관련 필드를 모두
 * `null`로 요구하므로 생성 중·실패 항목은 빈 값을 유지한다. `updatedAt`은
 * `Date#toISOString()` 형식만 통과한다.
 */
const MY_REPOSITORY_FIXTURES = [
  {
    repositoryId: 'synthetic-repo-basic',
    applicationId: 'synthetic-application-basic',
    applicationMode: 'PERSONAL',
    programName: '합성 기초 오픈소스 스터디',
    displayName: '합성 개인 실습 저장소',
    repositoryName: 'synthetic-basic-archive',
    githubUrl: 'https://github.com/JNU-SWCU/synthetic-basic-archive',
    provisionStatus: 'SUCCEEDED',
    invitationStatus: 'SUCCEEDED',
    visibility: 'PRIVATE',
    lastErrorCode: null,
    updatedAt: '2026-07-30T12:00:00.000Z',
  },
  {
    repositoryId: 'synthetic-repo-capstone',
    applicationId: 'synthetic-application-capstone',
    applicationMode: 'TEAM',
    programName: '합성 캡스톤 2026',
    displayName: '합성 캡스톤 팀 저장소',
    repositoryName: 'synthetic-capstone-archive',
    githubUrl: 'https://github.com/JNU-SWCU/synthetic-capstone-archive',
    provisionStatus: 'SUCCEEDED',
    invitationStatus: 'PENDING',
    visibility: 'PUBLIC',
    lastErrorCode: null,
    updatedAt: '2026-07-29T03:20:00.000Z',
  },
  {
    repositoryId: null,
    applicationId: 'synthetic-application-provisioning',
    applicationMode: 'TEAM',
    programName: '합성 OSS 경진대회',
    displayName: '합성 경진대회 팀 저장소',
    repositoryName: null,
    githubUrl: null,
    provisionStatus: 'PROCESSING',
    invitationStatus: null,
    visibility: null,
    lastErrorCode: null,
    updatedAt: '2026-07-31T01:05:00.000Z',
  },
  {
    repositoryId: null,
    applicationId: 'synthetic-application-failed',
    applicationMode: 'PERSONAL',
    programName: '합성 OSS 경진대회',
    displayName: '합성 경진대회 개인 저장소',
    repositoryName: null,
    githubUrl: null,
    provisionStatus: 'FAILED_FINAL',
    invitationStatus: null,
    visibility: null,
    lastErrorCode: 'SYNTHETIC_PROVISION_FAILED',
    updatedAt: '2026-07-28T22:41:00.000Z',
  },
] as const satisfies readonly MyRepositoryResponseItem[];

/** 설정·온보딩 화면이 함께 읽는 프로필. 파서가 `isComplete`와 값의 정합성을 검사한다. */
const MY_PROFILE_FIXTURE = {
  name: '합성 설정 사용자',
  studentId: '260001',
  department: '인공지능학부',
  isComplete: true,
} as const satisfies UserProfile;

const NOTIFICATION_CHANNEL_FIXTURE = {
  notificationEmail: 'fixture@example.com',
  notifyEnabled: true,
} as const;

const CONSENT_POLICY_VERSION = '2026-07-01';

/** 동의 후 이동 경로. 온보딩은 동의 → 프로필 → 역할 순서다. */
const CONSENT_NEXT_URL = '/onboarding/profile';

const CURRENT_CONSENT_FIXTURE = {
  policyVersion: CONSENT_POLICY_VERSION,
  requiredItems: [
    {
      key: 'synthetic-privacy',
      label: '[합성] 개인정보 수집·이용 동의',
      documentUrl: '/legal/synthetic-privacy',
    },
    {
      key: 'synthetic-activity',
      label: '[합성] 저장소 활동 수집 동의',
      documentUrl: '/legal/synthetic-activity',
    },
    {
      key: 'synthetic-archive',
      label: '[합성] 결과물 공개 아카이브 게시 동의',
      documentUrl: '/legal/synthetic-archive',
    },
  ],
  // `true`면 화면이 즉시 nextUrl로 빠져나가 동의 화면 자체를 볼 수 없다.
  consented: false,
  nextUrl: CONSENT_NEXT_URL,
} as const;

const ACCEPTED_CONSENT_FIXTURE = {
  policyVersion: CONSENT_POLICY_VERSION,
  consentedAt: '2026-08-01T00:00:00.000Z',
  nextUrl: CONSENT_NEXT_URL,
} as const;

const PENDING_STAFF_ROLE_REQUEST = {
  requestedRole: 'STAFF',
  status: 'PENDING',
  requestedAt: '2026-07-30T02:00:00.000Z',
  decidedAt: null,
  rejectionReason: null,
} as const satisfies RoleRequest;

/**
 * 역할 선택 결과. 요청 본문의 `selectedRole`(features/roles/api.ts `selectRole`)에
 * 따라 갈린다 — 학생은 역할이 즉시 확정돼 대시보드로, 교직원은 승인 대기 상태가
 * 되어 `/onboarding/pending`으로 간다. 화면은 `redirectTo`로 이동한다.
 *
 * 한계: 선택은 저장되지 않는다. 교직원을 골라 대기 화면으로 가더라도 그 화면이
 * 읽는 `role-requests/me`는 페르소나가 정하므로(`unassigned`는 `null`) 역할 선택
 * 화면으로 되돌아온다. 대기 화면 자체는 `role-pending` 페르소나로 검토한다.
 */
function roleSelectionResult(selected: RoleSelection): RoleSelectionResult {
  return selected === 'STAFF'
    ? {
        selectedRole: 'STAFF',
        role: null,
        requestStatus: 'PENDING',
        redirectTo: '/onboarding/pending',
      }
    : {
        selectedRole: 'STUDENT',
        role: 'STUDENT',
        requestStatus: null,
        redirectTo: '/dashboard',
      };
}

function publicProfileHandler(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  const params = matchGet(context, 'users/:userId/public-profile');
  if (params === null) return null;

  const userId = params.userId ?? '';
  const profile = PUBLIC_PROFILE_FIXTURES[userId];
  // 없는 사용자는 화면이 "찾을 수 없음"으로 갈리도록 백엔드 코드를 맞춘다.
  return profile === undefined
    ? notFound('PRF_001', context.path)
    : json(200, profile);
}

function myRepositoriesHandler(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  if (matchGet(context, 'repositories/me') === null) return null;
  return context.isAuthenticated
    ? json(200, { items: MY_REPOSITORY_FIXTURES })
    : unauthorized(context.path);
}

/**
 * `role-pending`은 동의·프로필·역할 요청을 이미 끝내고 승인만 기다리는 상태다.
 * 이 페르소나까지 `consented: false`를 주면 랜딩 진입 버튼(`/consent`)이 1단계
 * 약관 동의 화면에서 멈춰, 정작 이 페르소나가 존재하는 이유인 승인 대기 화면에
 * 아무도 도달하지 못한다. 동의를 마친 것으로 응답해야 ConsentFlow가 `nextUrl`로
 * 빠져나가고, 프로필이 완성(`isComplete: true`)이라 OnboardingGate가
 * `role-requests/me`의 `PENDING`을 보고 `/onboarding/pending`으로 이어 준다.
 */
function currentConsentFor(fixture: LocalReviewFixtureId) {
  return fixture === 'role-pending'
    ? { ...CURRENT_CONSENT_FIXTURE, consented: true }
    : CURRENT_CONSENT_FIXTURE;
}

function consentHandler(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  if (matchGet(context, 'consents/current') !== null) {
    return context.isAuthenticated
      ? json(200, currentConsentFor(context.fixture))
      : unauthorized(context.path);
  }

  if (context.method === 'POST' && context.path === 'consents') {
    return context.isAuthenticated
      ? json(200, ACCEPTED_CONSENT_FIXTURE)
      : unauthorized(context.path);
  }

  return null;
}

/** 프로필 규칙의 길이 상한. `features/profile`의 검증과 같은 값이다. */
const PROFILE_FIELD_MAX_LENGTH = 100;

/**
 * 프로필 파서(`features/profile/api.ts` `parseProfile`)는 `isComplete`가 값과
 * 어긋나면 응답을 거부한다 — 입력을 반영하면 완성 여부도 같이 계산해야 한다.
 * 모든 항목이 채워졌을 때만 완료로 보는 가장 엄격한 기준을 쓴다(어느 역할
 * 기준으로 보더라도 모순이 없다).
 */
function isCompleteProfile(profile: UserProfile): boolean {
  const filled = (value: string | null): boolean =>
    value !== null &&
    value.trim().length > 0 &&
    value.length <= PROFILE_FIELD_MAX_LENGTH;
  return (
    filled(profile.name) &&
    profile.studentId !== null &&
    /^\d{6,10}$/.test(profile.studentId) &&
    filled(profile.department)
  );
}

/**
 * 온보딩은 `{ name, studentId, department }`, 설정 화면은 학번을 뺀
 * `{ name, department }`를 보낸다(features/profile/api.ts). 안 보낸 항목은
 * 픽스처 값을 유지한다.
 */
function patchedProfile(context: LocalReviewContext): UserProfile {
  const patched = {
    name: bodyString(context, 'name') ?? MY_PROFILE_FIXTURE.name,
    studentId: bodyString(context, 'studentId') ?? MY_PROFILE_FIXTURE.studentId,
    department:
      bodyString(context, 'department') ?? MY_PROFILE_FIXTURE.department,
    isComplete: false,
  } satisfies UserProfile;
  return { ...patched, isComplete: isCompleteProfile(patched) };
}

/** 요청 본문은 `{ notificationEmail, notifyEnabled }`(알림 채널 API 계약). */
function patchedNotificationChannel(context: LocalReviewContext): {
  readonly notificationEmail: string | null;
  readonly notifyEnabled: boolean;
} {
  return {
    notificationEmail:
      bodyString(context, 'notificationEmail') ??
      NOTIFICATION_CHANNEL_FIXTURE.notificationEmail,
    notifyEnabled:
      bodyBoolean(context, 'notifyEnabled') ??
      NOTIFICATION_CHANNEL_FIXTURE.notifyEnabled,
  };
}

/**
 * 로그인 뒤 도착할 화면. 검토자가 "왜 갑자기 역할 선택이 떴지?" 하지 않도록
 * 질의로 출처를 남긴다 — 화면이 이 값을 읽어 한 줄 안내를 띄우면 된다.
 * (지금 `features/roles`는 질의를 읽지 않아 안내는 아직 보이지 않는다.)
 */
const LOCAL_REVIEW_LOGIN_SCREEN =
  '/onboarding/role?notice=local-review-login';

/**
 * `/onboarding/role`로 바로 보내면 안 된다 — 비로그인 상태 그대로라 온보딩
 * 게이트가 랜딩으로 되돌려 왕복만 한다. 미배정 페르소나를 켜면서 같은 화면으로
 * 이어 주는 활성화 경로를 거쳐야 로그인한 것처럼 이어진다.
 */
const LOCAL_REVIEW_LOGIN_REDIRECT = `/local-review/unassigned?to=${encodeURIComponent(
  LOCAL_REVIEW_LOGIN_SCREEN,
)}`;

/**
 * GitHub 로그인 시작 경로. 이건 `fetch`가 아니라 링크로 **브라우저가 통째로**
 * 이동하는 자리라(`_shell/landing-entry-action.tsx`의 `<a href>`), 규칙이 없으면
 * 404 JSON이 화면 대신 그대로 렌더된다. 실제 백엔드는 GitHub OAuth로 리다이렉트
 * 하므로 로컬 검토에서도 "이동"으로 답하는 편이 동선과 맞는다.
 */
function githubLoginHandler(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  if (matchGet(context, 'auth/github') === null) return null;
  return redirect(LOCAL_REVIEW_LOGIN_REDIRECT);
}

function accountMutationHandler(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  if (context.method === 'POST' && context.path === 'auth/logout') {
    // 로그아웃 확정을 주면 헤더가 랜딩(`/?logged-out=1`)으로 전체 이동한다.
    // 픽스처 쿠키는 그대로라 다음 화면에서 같은 페르소나로 되돌아온다.
    return json(200, { isAuthenticated: false });
  }

  if (context.method === 'PATCH' && context.path === 'users/me/profile') {
    // 입력한 값을 그대로 돌려준다 — 저장된 것처럼 보여야 검토가 이어진다.
    // 한계: 저장되지는 않아 새로고침하면 GET 픽스처의 기본 프로필로 돌아온다.
    return json(200, patchedProfile(context));
  }

  if (
    context.method === 'PATCH' &&
    context.path === 'users/me/notification-email'
  ) {
    // 마찬가지로 입력한 주소·수신 여부를 되돌려준다(저장은 되지 않는다).
    return json(200, patchedNotificationChannel(context));
  }

  return null;
}

function onboardingRoleHandler(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  if (context.method === 'POST' && context.path === 'onboarding/role') {
    // 본문을 못 읽으면 학생으로 본다 — 확정 경로가 있어야 화면이 넘어간다.
    const selected =
      bodyEnum<RoleSelection>(context, 'selectedRole', ['STUDENT', 'STAFF']) ??
      'STUDENT';
    return json(200, roleSelectionResult(selected));
  }

  // `/onboarding/pending`의 "다시 승인 요청하기"가 부르는 경로.
  if (context.method === 'POST' && context.path === 'role-requests') {
    return json(200, PENDING_STAFF_ROLE_REQUEST);
  }

  return null;
}

/**
 * 내 역할 요청 상태. 이 응답이 온보딩의 갈림길을 정한다 —
 * `null`이면 역할 선택 화면으로, `PENDING`이면 승인 대기 화면으로 간다.
 * 그래서 대기 화면을 검토하려면 `role-pending` 페르소나가 필요하다.
 */
function myRoleRequestHandler(
  context: LocalReviewContext,
): LocalReviewResponsePlan | null {
  if (matchGet(context, 'role-requests/me') === null) return null;
  if (!context.isAuthenticated) return unauthorized(context.path);
  return context.fixture === 'role-pending'
    ? json(200, PENDING_STAFF_ROLE_REQUEST)
    : json(200, null);
}

export const ACCOUNT_HANDLERS: readonly LocalReviewHandler[] = [
  githubLoginHandler,
  myRoleRequestHandler,
  publicProfileHandler,
  myRepositoriesHandler,
  consentHandler,
  accountMutationHandler,
  onboardingRoleHandler,
];
