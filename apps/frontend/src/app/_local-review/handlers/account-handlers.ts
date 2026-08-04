import {
  isConsistentCompleteProfile,
  isProfileComplete,
  type ProfileRole,
} from '@/features/profile/profile-requirements';
import type {
  PublicProfile,
  PublicProfileCategory,
  PublicProfileProject,
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
  localReviewSessionState,
  matchGet,
  notFound,
  roleForFixture,
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
type PublicProfileApiProject = Omit<
  PublicProfileProject,
  'modeLabel' | 'publishedLabel'
>;

type PublicProfileApiResponse = Omit<PublicProfile, 'projects'> & {
  readonly projects: readonly PublicProfileApiProject[];
};

type PublicProfileProjectInput = {
  readonly projectId: string;
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
 * `detailUrl === /archive/{projectId}`, `publishedAt`은 `toISOString()` 형식만
 * 통과시키므로 그대로 맞춘다. 저장소 id는 공개 아카이브 픽스처와 같은 값을 써야
 * 프로필 → 아카이브 상세 이동이 끊기지 않는다.
 */
function publicProfileProject(
  input: PublicProfileProjectInput,
): PublicProfileApiProject {
  return {
    projectId: input.projectId,
    programId: input.programId,
    programName: input.programName,
    category: input.category,
    applicationMode: input.applicationMode,
    displayName: input.displayName,
    repositoryName: input.repositoryName,
    githubUrl: `https://github.com/JNU-SWCU/${input.repositoryName}`,
    publishedAt: input.publishedAt,
    detailUrl: `/archive/${input.projectId}`,
    // 수집이 이 저장소를 관측했는지. 셋은 서로의 존재를 함께 증명해야 해서
    // 파서가 어긋난 조합(관측했다면서 metrics 가 없는 등)을 거부한다.
    observed: true,
    dataAsOf: '2026-07-31T00:00:00.000Z',
    metrics: { commitCount: 12, pullRequestCount: 3, releaseCount: 1 },
  };
}

const CAPSTONE_PROFILE_PROJECT = publicProfileProject({
  projectId: 'synthetic-repo-capstone',
  programId: 'program-capstone',
  programName: '합성 캡스톤 2026',
  category: 'CAPSTONE',
  applicationMode: 'TEAM',
  displayName: '합성 캡스톤 팀 저장소',
  repositoryName: 'synthetic-capstone-archive',
  publishedAt: '2026-06-20T00:00:00.000Z',
});

const CONTEST_PROFILE_PROJECT = publicProfileProject({
  projectId: 'synthetic-repo-contest',
  programId: 'program-oss-contest',
  programName: '합성 OSS 경진대회',
  category: 'OSS_CONTEST',
  applicationMode: 'TEAM',
  displayName: '합성 경진대회 팀 저장소',
  repositoryName: 'synthetic-contest-archive',
  publishedAt: '2026-05-12T00:00:00.000Z',
});

const BASIC_PROFILE_PROJECT = publicProfileProject({
  projectId: 'synthetic-repo-basic',
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
    projects: [CAPSTONE_PROFILE_PROJECT, CONTEST_PROFILE_PROJECT],
    observedTotals: { commitCount: 12, pullRequestCount: 3, releaseCount: 1 },
  },
  'synthetic-user-02': {
    userId: 'synthetic-user-02',
    githubNickname: 'synthetic-contributor-02',
    avatarUrl: null,
    projects: [CAPSTONE_PROFILE_PROJECT],
    observedTotals: { commitCount: 12, pullRequestCount: 3, releaseCount: 1 },
  },
  'synthetic-user-03': {
    userId: 'synthetic-user-03',
    githubNickname: 'synthetic-contributor-03',
    avatarUrl: null,
    projects: [CONTEST_PROFILE_PROJECT],
    observedTotals: { commitCount: 12, pullRequestCount: 3, releaseCount: 1 },
  },
  'synthetic-user-04': {
    userId: 'synthetic-user-04',
    githubNickname: 'synthetic-contributor-04',
    avatarUrl: null,
    projects: [BASIC_PROFILE_PROJECT],
    observedTotals: { commitCount: 12, pullRequestCount: 3, releaseCount: 1 },
  },
  'synthetic-user-05': {
    userId: 'synthetic-user-05',
    githubNickname: 'synthetic-contributor-05',
    avatarUrl: null,
    projects: [],
    observedTotals: { commitCount: 0, pullRequestCount: 0, releaseCount: 0 },
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

/**
 * 아직 아무것도 채우지 않은 프로필 — 방금 가입한 사용자가 보는 상태다.
 *
 * 순서를 역할 → 프로필로 바꾼 뒤 검토해야 할 화면이 바로 여기다: 교직원을 고른
 * 사람이 프로필 단계에서 학번을 요구받지 않는지 눈으로 확인하려면, 미배정 페르소나의
 * 프로필이 비어 있어야 한다. 완성된 프로필을 주면 화면이 즉시 다음 단계로 빠져나간다.
 */
const EMPTY_PROFILE_FIXTURE = {
  name: 'GitHub 합성 이름',
  studentId: null,
  department: null,
  isComplete: false,
} as const satisfies UserProfile;

/** 온보딩 중인 페르소나(`unassigned`)만 빈 프로필을 본다. */
export function myProfileFixtureFor(
  fixture: LocalReviewFixtureId,
): UserProfile {
  if (fixture !== 'unassigned') {
    return MY_PROFILE_FIXTURE;
  }
  return (
    localReviewSessionState().savedOnboardingProfile ?? EMPTY_PROFILE_FIXTURE
  );
}

const NOTIFICATION_CHANNEL_FIXTURE = {
  notificationEmail: 'fixture@example.com',
  notifyEnabled: true,
} as const;

/**
 * 백엔드 `consents/domain/consent-policy.ts`의 `CONSENT_POLICY_VERSION`과 같은 값이다.
 * 문서 파일 이름이 곧 이 버전이라(`public/policies/{항목}/{버전}.html`) 어긋나면 전문이 404가 된다.
 */
const CONSENT_POLICY_VERSION = '2026-08-04';

/**
 * 동의 후 이동 경로. 온보딩은 동의 → **역할** → 프로필 순서다.
 *
 * 프로필을 먼저 받으면 그 화면이 역할을 몰라 학생 기준으로 판정하고, 학번이 필요 없는
 * 교직원·관리자가 가짜 학번을 지어내야 한다. 백엔드 `consents/domain/consent-policy.ts`의
 * `nextUrl`과 같은 값을 유지한다.
 */
const CONSENT_NEXT_URL = '/onboarding/role';

/**
 * 필수 동의 항목. 백엔드 `CURRENT_CONSENT_POLICY.requiredItems`를 그대로 미러링한다.
 *
 * 여기만 `[합성]` 접두사를 떼는 이유: 이 세 문서는 제품이 실제로 배포하는 진짜 약관이고
 * (`public/policies/`), 그 내용이 곧 검토 대상이다. 합성이라고 이름 붙이면 검토자가
 * 실제 약관을 읽고도 "지어낸 문장"으로 넘겨 짚는다. 예전에는 `/legal/synthetic-*` 라는
 * 없는 주소를 가리켜 "전문 보기"가 404 빈 화면이었다 — 라벨만 진짜처럼 보이고 내용이
 * 없는 쪽이 훨씬 나쁜 오해를 만든다.
 *
 * 합성인 것은 **사용자 데이터**지 약관 문서가 아니다. 그 사실은 이 화면 위에 그대로
 * 남아 있다 — 헤더의 계정 이름이 `synthetic-unassigned`이고, 프로필·저장소 픽스처도
 * 모두 `합성 …` 이름을 쓴다.
 */
const CURRENT_CONSENT_FIXTURE = {
  policyVersion: CONSENT_POLICY_VERSION,
  requiredItems: [
    {
      key: 'PRIVACY_COLLECTION',
      label: '개인정보 수집·이용',
      documentUrl: `/policies/privacy/${CONSENT_POLICY_VERSION}.html`,
    },
    {
      key: 'GITHUB_ACTIVITY',
      label: 'GitHub 활동 수집·공개 범위',
      documentUrl: `/policies/github-activity/${CONSENT_POLICY_VERSION}.html`,
    },
    {
      key: 'ORG_REPOSITORY_TERMS',
      label: 'Org 저장소 운영 약관',
      documentUrl: `/policies/org-repository-terms/${CONSENT_POLICY_VERSION}.html`,
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
 * 가입을 마쳤는가 — 고른 역할이 확정될 조건을 갖췄는가.
 *
 * 실물은 프로필이 **완료 저장되는 순간** 확정한다(#569, 백엔드
 * `users.repository.ts`의 `completeProfileIfUnchanged`). 픽스처도 같은 조건을 써야
 * 한다: 여기서 저장을 기다리지 않고 고르자마자 확정하면, 검토 화면에서는 확정이
 * 일어나는데 실물에서는 일어나지 않는다.
 */
function hasFinishedSignup(): boolean {
  return localReviewSessionState().savedOnboardingProfile?.isComplete === true;
}

/**
 * 학생으로 가입을 **마친** 뒤의 세션 역할. 그전이거나 교직원을 골랐으면 `null`이다.
 *
 * 세션 응답(`fixture-response.ts`)이 이 값을 읽어야 학생 확정이 실제로 반영된다.
 * 교직원은 관리자 승인 전까지 세션 역할이 비는 것이 정상이라 여기서 빠진다.
 *
 * **고르는 것만으로는 배정되지 않는다.** 예전에는 고르는 즉시 배정했는데, 실물이
 * 그때 그랬기 때문이다. 확정이 `가입 마치기`로 옮겨 간 지금 같은 값을 주면, 검토에서는
 * 프로필을 건너뛰고 대시보드에 들어갈 수 있는데 실배포에서는 막힌다.
 *
 * 값을 어디에 두는지도 규칙이다. 고른 역할·저장한 프로필은 요청 사이에 남아야 하므로
 * 검토 세션 상태(`handler-kit`의 `localReviewSessionState`)에 둔다. **모듈 최상단
 * `let`으로 되돌리지 마라** — 화면이 처음 열려 컴파일되는 순간 값이 사라져 고른 역할이
 * 없던 일이 된다. 자세한 근거는 그 함수의 주석에 있다.
 */
export function reviewAssignedRole(): 'STUDENT' | null {
  return localReviewSessionState().selectedRole === 'STUDENT' &&
    hasFinishedSignup()
    ? 'STUDENT'
    : null;
}

/**
 * 세션 응답(`auth/me`)이 실을 `isProfileComplete`.
 *
 * 실물은 이 값을 **배정된 역할 기준**으로만 계산한다(백엔드 `auth.repository.ts`의
 * `toDomain`). 역할이 없는 동안에는 가장 엄격한 학생 기준이라, 학번 없이 프로필을
 * 마친 교직원은 여기서 미완료로 나오는 것이 정상이다 — 그 사람이 회원인지는 세션이
 * 아니라 살아 있는 역할 요청이 답한다(`_shell/signup-completion.ts`).
 *
 * 프로필 응답(`users/me/profile`)의 `isComplete`와 다른 값이 될 수 있고, 그 차이가
 * 실물의 계약이다. 두 값을 같게 맞추면 검토에서만 통과하는 화면이 만들어진다.
 */
export function reviewSessionProfileComplete(): boolean {
  return isProfileComplete(
    myProfileFixtureFor('unassigned'),
    reviewAssignedRole(),
  );
}

/** 테스트·검토 초기화 전용. 실패 예산 같은 다른 값은 건드리지 않는다. */
export function resetLocalReviewRoleSelection(): void {
  const state = localReviewSessionState();
  state.selectedRole = null;
  state.savedOnboardingProfile = null;
}

/**
 * 역할 선택 결과 — **두 역할의 답이 완전히 같다.**
 *
 * 이 화면은 아무것도 확정하지 않고 고른 사실만 기록하므로(#569) 알려 줄 확정 결과가
 * 없다. 백엔드 `roles/dto/role-selection-response.dto.ts`가 `role`·`requestStatus`를
 * 아예 싣지 않으므로 여기서도 싣지 않는다 — 픽스처에만 남겨 두면 화면이 실배포에는
 * 없는 값을 읽게 된다.
 *
 * **두 역할 모두 `/onboarding/profile`로 간다.** 고르기만 해서는 가입이 끝난 것이
 * 아니고, 교직원도 학과가 필수라(백엔드 `users/user-profile-policy.ts`) 남은 단계가
 * 프로필이기 때문이다. 예전에 교직원만 `/onboarding/pending`을 주던 때는 그 화면의
 * `OnboardingGate`가 비어 있는 프로필을 보고 즉시 프로필로 되돌려, 승인 대기 화면이
 * 반 초쯤 떴다 사라졌다.
 */
function roleSelectionResult(selected: RoleSelection): RoleSelectionResult {
  return { selectedRole: selected, redirectTo: '/onboarding/profile' };
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

/**
 * 이 프로필을 어느 역할 기준으로 볼지. 온보딩 중인 페르소나만 고른 역할을 따른다.
 *
 * 교직원을 고른 사람은 승인 전이라 세션 역할이 아직 비어 있지만, 프로필 화면은
 * 이미 교직원 기준으로 학번을 묻지 않는다(`_shell/onboarding-route.ts`의
 * `effectiveProfileRole`이 살아 있는 `PENDING` 요청을 STAFF로 인정한다). 픽스처가
 * 같은 기준을 쓰지 않으면 화면에서는 학번을 묻지 않는데 저장만 안 되는 모순이 뜬다.
 *
 * 고르기 전이면 `null`이고, 규칙은 `null`을 학생 기준으로 본다 — 백엔드가 역할
 * 배정 전에 학번을 포함한 완료 프로필을 요구하므로 그 편이 맞다.
 */
function reviewProfileRole(fixture: LocalReviewFixtureId): ProfileRole | null {
  return fixture === 'unassigned'
    ? localReviewSessionState().selectedRole
    : (roleForFixture(fixture) ?? reviewFixedSelectedRole(fixture));
}

/**
 * 고정 페르소나가 "골라 둔" 역할.
 *
 * 실물은 이미 확정된 사용자의 `selectedRole`을 확정 역할에서 backfill하고, 승인을
 * 기다리는 교직원에게는 `STAFF`를 남긴다(`prisma/migrations/…add_user_selected_role`).
 * 여기서도 같은 값을 준다 — 역할이 이미 붙은 페르소나는 `roleForFixture`가 답하므로
 * 이 함수가 실제로 답할 것은 승인 대기 교직원뿐이다. 관리자는 역할 선택 화면에 없는
 * 값이라 backfill에서도 빠진다.
 */
function reviewFixedSelectedRole(
  fixture: LocalReviewFixtureId,
): RoleSelection | null {
  return fixture === 'role-pending' ? 'STAFF' : null;
}

/**
 * 프로필 파서(`features/profile/api.ts` `parseProfile`)는 `isComplete`가 값과
 * 어긋나면 응답을 거부한다 — 입력을 반영하면 완성 여부도 같이 계산해야 한다.
 *
 * 판정 규칙은 여기서 다시 만들지 않는다. 역할별 필수 항목의 단일 출처는
 * `features/profile/profile-requirements.ts`이고, 화면의 폼 검증·요청 빌더·응답
 * 파서가 모두 그 파일을 쓴다. 픽스처만 규칙을 따로 들고 있으면 규칙이 바뀔 때
 * 이쪽만 조용히 남아, 화면과 픽스처가 서로 다른 답을 낸다.
 *
 * 두 함수를 **함께** 본다. `isProfileComplete`는 그 역할이 요구하는 항목이 다
 * 찼는지만 보므로, 교직원처럼 학번을 요구하지 않는 역할에서는 형식이 깨진 학번이
 * 실려 와도 완료로 본다. 그대로 `isComplete: true`로 답하면 파서가
 * `isConsistentCompleteProfile`로 그 모순을 잡아 응답 자체를 거부하고, 검토자는
 * "저장 실패"만 본다. 그래서 파서가 볼 불변식을 여기서 먼저 확인한다.
 */
function isCompleteProfile(
  profile: UserProfile,
  fixture: LocalReviewFixtureId,
): boolean {
  return (
    isProfileComplete(profile, reviewProfileRole(fixture)) &&
    isConsistentCompleteProfile(profile)
  );
}

/**
 * 온보딩은 `{ name, studentId, department }`, 설정 화면은 학번을 뺀
 * `{ name, department }`를 보낸다(features/profile/api.ts). 안 보낸 항목은
 * 픽스처 값을 유지한다.
 */
function patchedProfile(context: LocalReviewContext): UserProfile {
  const base = myProfileFixtureFor(context.fixture);
  const patched = {
    name: bodyString(context, 'name') ?? base.name,
    studentId: bodyString(context, 'studentId') ?? base.studentId,
    department: bodyString(context, 'department') ?? base.department,
    isComplete: false,
  } satisfies UserProfile;
  return {
    ...patched,
    isComplete: isCompleteProfile(patched, context.fixture),
  };
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
 * 로그인 뒤 도착할 화면. **실제 backend와 같은 곳이어야 한다** —
 * `auth/domain/login-landing.ts`의 `ONBOARDING_ENTRY_PATH`가 `/consent`다.
 * 가입 순서를 `약관 → 역할 → 프로필`로 바꿀 때 이 값만 옛 순서(`/onboarding/role`)로
 * 남아, 검토에서는 로그인 직후 약관을 건너뛰고 역할 선택이 떴다.
 *
 * 검토자가 "왜 갑자기 이 화면이 떴지?" 하지 않도록 질의로 출처를 남긴다.
 * (지금 `features/consents`는 질의를 읽지 않아 안내는 아직 보이지 않는다.)
 */
const LOCAL_REVIEW_LOGIN_SCREEN = '/consent?notice=local-review-login';

/**
 * 목적지로 바로 보내면 안 된다 — 비로그인 상태 그대로라 온보딩 게이트가
 * 랜딩으로 되돌려 왕복만 한다. 미배정 페르소나를 켜면서 같은 화면으로 이어 주는
 * 활성화 경로를 거쳐야 로그인한 것처럼 이어진다.
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
    // 온보딩 중인 페르소나만 저장을 기억한다 — 저장 뒤 다음 화면의 게이트가 다시
    // 프로필을 조회하기 때문에, 잊어버리면 그 자리에서 왕복이 시작된다.
    const profile = patchedProfile(context);
    if (context.fixture === 'unassigned') {
      localReviewSessionState().savedOnboardingProfile = profile;
    }
    return json(200, profile);
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
  // 지금 고른 역할. 되돌아온 역할 선택 화면이 이전 선택을 되살리고, 프로필 화면이
  // 무엇을 물을지 정하는 근거다(#569). 아직 고르지 않았으면 `null`을 **본문에 실어**
  // 답한다 — 백엔드도 `{ selectedRole: null }`을 주지 빈 응답을 주지 않는다.
  if (matchGet(context, 'onboarding/role') !== null) {
    if (!context.isAuthenticated) return unauthorized(context.path);
    return json(200, {
      selectedRole:
        context.fixture === 'unassigned'
          ? localReviewSessionState().selectedRole
          : reviewFixedSelectedRole(context.fixture),
    });
  }

  if (context.method === 'POST' && context.path === 'onboarding/role') {
    // 본문을 못 읽으면 학생으로 본다 — 확정 경로가 있어야 화면이 넘어간다.
    const selected =
      bodyEnum<RoleSelection>(context, 'selectedRole', ['STUDENT', 'STAFF']) ??
      'STUDENT';
    localReviewSessionState().selectedRole = selected;
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
  // 교직원을 **골랐다는 것만으로는** 요청이 생기지 않는다 — 프로필을 마쳐야 생긴다
  // (#569). 고르자마자 PENDING을 주면 검토자가 "미완성 신청이 대기줄에 올라오지
  // 않는다"를 확인할 수 없고, 프로필 화면의 되돌아가기 링크도 사라진다.
  const isPending =
    context.fixture === 'role-pending' ||
    (context.fixture === 'unassigned' &&
      localReviewSessionState().selectedRole === 'STAFF' &&
      hasFinishedSignup());
  return isPending ? json(200, PENDING_STAFF_ROLE_REQUEST) : json(200, null);
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
