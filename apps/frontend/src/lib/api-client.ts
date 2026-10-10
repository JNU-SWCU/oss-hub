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

const UNEXPECTED_PROBLEM_CODE = 'API_000';

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

export function isUnexpectedApiProblem(error: unknown): boolean {
  return (
    error instanceof ApiError && error.problem.code === UNEXPECTED_PROBLEM_CODE
  );
}

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
