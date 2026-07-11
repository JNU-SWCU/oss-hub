const baseURL = "/api/v1";

export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
}

export class ApiError extends Error {
  constructor(public readonly problem: ProblemDetail) {
    super(problem.detail || problem.title);
    this.name = "ApiError";
  }
}

function isProblemDetail(value: unknown): value is ProblemDetail {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const problem = value as Record<string, unknown>;
  return (
    typeof problem.type === "string" &&
    typeof problem.title === "string" &&
    typeof problem.status === "number" &&
    typeof problem.detail === "string" &&
    typeof problem.instance === "string" &&
    typeof problem.code === "string"
  );
}

function createUnexpectedProblem(response: Response, instance: string): ProblemDetail {
  return {
    type: "about:blank",
    title: response.statusText || "요청 처리 실패",
    status: response.status,
    detail: "API 오류 응답이 ProblemDetail 형식이 아닙니다.",
    instance,
    code: "API_000",
  };
}

export async function apiClient<T>(path: string, init?: RequestInit): Promise<T> {
  const endpoint = path.startsWith("/") ? path : `/${path}`;
  const response = await fetch(`${baseURL}${endpoint}`, init);

  if (response.ok) {
    return response.json() as Promise<T>;
  }

  const body: unknown = await response.json().catch(() => undefined);
  const problem = isProblemDetail(body)
    ? body
    : createUnexpectedProblem(response, `${baseURL}${endpoint}`);

  throw new ApiError(problem);
}
