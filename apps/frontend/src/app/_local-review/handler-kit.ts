import type { AuthRole } from '@/features/auth/types';
import { apiPath } from '@/lib/api-client';
import type { LocalReviewFixtureId } from './fixture-contract';

/**
 * 로컬 검토 픽스처의 응답 규칙을 도메인별로 나눠 담기 위한 최소 계약.
 *
 * 규칙이 한 파일의 if 체인으로 몰려 있으면 화면이 늘 때마다 같은 자리를 고치게
 * 되고, 어떤 화면이 왜 막히는지도 읽히지 않는다. 핸들러는 자기가 아는 경로만
 * 응답하고 나머지는 `null`을 돌려 다음 핸들러에게 넘긴다.
 */
/**
 * 브라우저를 통째로 옮기는 응답. `fetch`로 부르는 경로는 JSON이면 충분하지만,
 * 로그인처럼 **링크로 전체 이동하는** 경로는 JSON을 주면 검토자가 화면 대신
 * 원시 JSON을 보게 된다 — 그런 경로는 화면으로 되돌려 보내야 한다.
 */
export type LocalReviewRedirectStatus = 303 | 307;

export type LocalReviewResponsePlan =
  | { readonly kind: 'json'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'delay'; readonly milliseconds: number }
  | {
      readonly kind: 'redirect';
      readonly status: LocalReviewRedirectStatus;
      /** 앱 내부 경로만 쓴다(`/`로 시작). 요청 값이 아니라 규칙이 정한 상수여야 한다. */
      readonly location: string;
    };

export interface LocalReviewContext {
  readonly fixture: LocalReviewFixtureId;
  readonly method: string;
  /** `api/v1` 접두사를 뗀 경로. 예: `programs/program-capstone/viewer` */
  readonly path: string;
  readonly searchParams: URLSearchParams;
  /** 이 페르소나의 역할. 비로그인은 `null`이고 역할 미배정도 `null`이다 */
  readonly role: AuthRole | null;
  readonly isAuthenticated: boolean;
  /**
   * 파싱된 요청 본문(JSON). 본문이 없거나(GET·DELETE) JSON이 아니면 `undefined`다.
   * 승인·반려처럼 **무엇을 눌렀는지가 본문에만 있는** 조작은 이 값을 봐야 한다 —
   * 없으면 반려를 눌러도 승인이 돌아와 검토자가 제품 버그로 오해한다.
   */
  readonly body?: unknown;
}

export type LocalReviewHandler = (
  context: LocalReviewContext,
) => LocalReviewResponsePlan | null;

export function json(status: number, body: unknown): LocalReviewResponsePlan {
  return { kind: 'json', status, body };
}

/**
 * 다른 화면으로 보낸다. 기본은 303 — 무엇으로 눌러 왔든 목적지는 GET으로 열려야
 * 하고(307은 메서드를 유지해 POST가 화면에 다시 날아간다), "여기 말고 저기를
 * 보라"는 뜻이 이 상황과 정확히 맞는다.
 */
export function redirect(
  location: string,
  status: LocalReviewRedirectStatus = 303,
): LocalReviewResponsePlan {
  return { kind: 'redirect', status, location };
}

export function problem(
  status: number,
  code: string,
  instance: string,
  detail = 'The selected local review fixture returned an error.',
): LocalReviewResponsePlan {
  return json(status, {
    type: 'about:blank',
    title: 'Local review fixture response',
    status,
    detail,
    instance,
    code,
  });
}

/** 실제 백엔드가 주는 것과 같은 코드로 404를 만든다 — 화면이 "찾을 수 없음"으로 갈리게 하려면 필요하다 */
export function notFound(code: string, path: string): LocalReviewResponsePlan {
  return problem(404, code, apiPath(path));
}

export function unauthorized(path: string): LocalReviewResponsePlan {
  return problem(401, 'AUTH_401', apiPath(path));
}

export function roleForFixture(fixture: LocalReviewFixtureId): AuthRole | null {
  switch (fixture) {
    case 'student':
    case 'settings':
    case 'wrong-role':
    // 세션 조회가 복구되고 나면 평범한 학생이다. 역할을 주지 않으면 복구 직후
    // 화면이 온보딩으로 튕겨, 복구된 결과가 아니라 가입 흐름을 보게 된다.
    case 'error-once':
      return 'STUDENT';
    case 'staff':
      return 'STAFF';
    case 'admin':
      return 'ADMIN';
    default:
      return null;
  }
}

export function isAuthenticatedFixture(
  fixture: LocalReviewFixtureId,
): boolean {
  return fixture !== 'anonymous' && fixture !== 'loading' && fixture !== 'error';
}

/**
 * `programs/:id/viewer` 같은 패턴에서 파라미터를 뽑는다.
 * 일치하지 않으면 `null`. 세그먼트 수가 다르면 즉시 탈락한다.
 */
export function matchPath(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index] as string;
    const actual = pathParts[index] as string;
    if (expected.startsWith(':')) {
      if (actual === '') return null;
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }
  return params;
}

/** GET 요청이면서 패턴에 맞을 때만 파라미터를 준다 */
export function matchGet(
  context: LocalReviewContext,
  pattern: string,
): Record<string, string> | null {
  return context.method === 'GET' ? matchPath(pattern, context.path) : null;
}

/**
 * 요청 본문을 객체로 볼 때만 레코드를 준다. 본문 없음·배열·원시값은 모두 `null`이라
 * 규칙은 "본문을 못 읽은 경우"를 한 자리에서 처리하면 된다.
 */
export function bodyRecord(
  context: LocalReviewContext,
): Record<string, unknown> | null {
  const { body } = context;
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

export function bodyString(
  context: LocalReviewContext,
  key: string,
): string | null {
  const value = bodyRecord(context)?.[key];
  return typeof value === 'string' ? value : null;
}

/**
 * `null`을 보낼 수 있는 항목(마일스톤 안내·프로그램 종료일 등)을 읽는다.
 * "안 보냈다"(`undefined`)와 "비웠다"(`null`)를 구분해야 빈 값을 되돌려 줄 수 있다.
 */
export function bodyNullableString(
  context: LocalReviewContext,
  key: string,
): string | null | undefined {
  const record = bodyRecord(context);
  if (record === null || !(key in record)) return undefined;
  const value = record[key];
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

export function bodyBoolean(
  context: LocalReviewContext,
  key: string,
): boolean | null {
  const value = bodyRecord(context)?.[key];
  return typeof value === 'boolean' ? value : null;
}

/**
 * 화면 계약에 있는 값일 때만 통과시킨다. 임의 문자열을 그대로 응답에 실으면
 * 파서가 거부하는 응답이 만들어져 "저장 실패"로 보인다.
 */
export function bodyEnum<T extends string>(
  context: LocalReviewContext,
  key: string,
  allowed: readonly T[],
): T | null {
  const value = bodyString(context, key);
  return value !== null && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

export function positiveIntParam(
  value: string | null,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** 조작(POST/PATCH/DELETE) 성공 응답 — 화면이 낙관적으로 갱신되도록 200을 준다 */
export function accepted(body: unknown = {}): LocalReviewResponsePlan {
  return json(200, body);
}
