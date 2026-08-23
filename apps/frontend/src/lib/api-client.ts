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

function createUnexpectedProblem(
  response: Response,
  instance: string,
): ProblemDetail {
  return {
    type: 'about:blank',
    title: response.statusText || '요청 처리 실패',
    status: response.status,
    detail: 'API 오류 응답이 ProblemDetail 형식이 아닙니다.',
    instance,
    code: 'API_000',
  };
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
