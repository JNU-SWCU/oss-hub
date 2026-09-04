const baseURL = '/api/v1';

export interface ProblemDetail {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string;
  readonly code: string;
  readonly fieldErrors?: readonly ProblemDetailFieldError[];
}

export interface ProblemDetailFieldError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export interface ApiFileDownload {
  readonly blob: Blob;
  readonly fileName: string;
}

export class ApiError extends Error {
  constructor(public readonly problem: ProblemDetail) {
    super(problem.detail || problem.title);
    this.name = 'ApiError';
  }
}

function isProblemDetail(value: unknown): value is ProblemDetail {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const problem = value as Record<string, unknown>;
  return (
    typeof problem.type === 'string' &&
    typeof problem.title === 'string' &&
    typeof problem.status === 'number' &&
    typeof problem.detail === 'string' &&
    typeof problem.instance === 'string' &&
    typeof problem.code === 'string'
  );
}

/** ProblemDetail이 아닌 응답을 감쌀 때 붙이는 코드. 이 코드가 곧 「서버 말이 없다」는 뜻이다. */
export const UNEXPECTED_PROBLEM_CODE = 'API_000';

/**
 * 서버 말이 없을 때 화면에 나갈 문장.
 *
 * ⚠ 여기에 개발자용 진단 문장을 두면 그대로 사용자 화면에 붙는다 — 실제로 붙었다.
 *   서류를 내려던 학생이 본 것은 「API 오류 응답이 ProblemDetail 형식이 아닙니다.」였고,
 *   무엇이 잘못됐는지도 무엇을 고쳐야 하는지도 알 수 없었다(#1107). 진단은 이 문장이 아니라
 *   `code`(`API_000`)·`status`·`instance`로 한다.
 */
const UNEXPECTED_PROBLEM_DETAIL =
  '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';

function createUnexpectedProblem(
  response: Response,
  instance: string,
): ProblemDetail {
  return {
    type: 'about:blank',
    title: response.statusText || '요청 처리 실패',
    status: response.status,
    detail: UNEXPECTED_PROBLEM_DETAIL,
    instance,
    code: UNEXPECTED_PROBLEM_CODE,
  };
}

/**
 * 서버가 ProblemDetail을 주지 못한 실패인가. 참이면 `problem.detail`은 서버가 한 말이
 * 아니라 이 클라이언트가 지어낸 일반 문장이므로, 화면은 자기 맥락의 문구를 대신 쓴다.
 */
export function isUnexpectedApiProblem(error: unknown): boolean {
  return (
    error instanceof ApiError && error.problem.code === UNEXPECTED_PROBLEM_CODE
  );
}

/** baseURL(`/api/v1`)의 유일한 소유자로서 브라우저용 경로를 만든다 — 링크 href 등에도 이것만 쓴다. */
export function apiPath(path: string): string {
  const endpoint = path.startsWith('/') ? path : `/${path}`;
  return `${baseURL}${endpoint}`;
}

export async function apiClient<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const target = apiPath(path);
  const response = await fetch(target, init);

  if (response.ok) {
    // 본문 없는 성공 응답은 `null`로 읽는다. Nest는 handler가 `null`을 돌려주면
    // 본문을 아예 붙이지 않고 200을 보내는데(`role-requests/me`가 그렇다),
    // 그 응답에 `response.json()`을 걸면 `SyntaxError`로 거절된다. 호출부는 그
    // 거절을 조회 실패로 읽어 화면 전체를 오류로 접었다 — 역할 요청이 아직 없는
    // 신규 가입자는 첫 화면에서 더 갈 곳이 없었다. `null`을 정상값으로 기대하는
    // 쪽(`StaffAccessRequest | null`)이 이미 있으므로 여기서 그 형태로 맞춘다.
    const body = await response.text();
    return (body.length === 0 ? null : JSON.parse(body)) as T;
  }

  const body: unknown = await response.json().catch(() => undefined);
  const problem = isProblemDetail(body)
    ? body
    : createUnexpectedProblem(response, target);

  throw new ApiError(problem);
}

export async function apiFileClient(
  path: string,
  init?: RequestInit,
): Promise<ApiFileDownload> {
  const target = apiPath(path);
  const response = await fetch(target, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    throw new ApiError(
      isProblemDetail(body) ? body : createUnexpectedProblem(response, target),
    );
  }

  return {
    blob: await response.blob(),
    fileName: contentDispositionFileName(
      response.headers.get('content-disposition'),
    ),
  };
}

function contentDispositionFileName(header: string | null): string {
  if (header === null) return 'file';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.at(1);
  if (encoded !== undefined) {
    try {
      return safeDownloadFileName(decodeURIComponent(encoded));
    } catch (error: unknown) {
      if (!(error instanceof URIError)) throw error;
    }
  }
  const fallback = /filename="([^"]*)"/i.exec(header)?.at(1) ?? 'file';
  return safeDownloadFileName(fallback);
}

function safeDownloadFileName(value: string): string {
  const baseName = value.replaceAll('\\', '/').split('/').at(-1) ?? '';
  const sanitized = [...baseName]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join('')
    .trim();
  return sanitized.length > 0 && sanitized !== '.' && sanitized !== '..'
    ? sanitized
    : 'file';
}
