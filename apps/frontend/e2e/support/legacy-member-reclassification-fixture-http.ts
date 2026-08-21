import type { Route } from '@playwright/test';

export const RECLASSIFICATION_PATH =
  '/api/v1/users/me/legacy-member-reclassification';
export const SESSION_PATH = '/api/v1/auth/session';
export const TASK_10_BROWSER_TIMEOUT = 10_000;

export async function fulfillJson(
  route: Route,
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Promise<void> {
  await route.fulfill({
    status,
    headers,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

export async function fulfillProblem(
  route: Route,
  status: number,
  detail: string,
  headers: Readonly<Record<string, string>>,
): Promise<void> {
  await route.fulfill({
    status,
    headers,
    contentType: 'application/problem+json',
    body: JSON.stringify({
      type: 'about:blank',
      title: status === 409 ? 'Conflict' : 'Synthetic failure',
      status,
      detail,
      instance: RECLASSIFICATION_PATH,
      code: status === 409 ? 'USR_012' : 'TST_500',
    }),
  });
}
