import type { Request, Response } from '@playwright/test';

import { expect, test } from './admin-session.fixture';
import { e2eEnvironment } from './environment';

function pathnameOf(requestOrResponse: Request | Response): string {
  return new URL(requestOrResponse.url()).pathname;
}

function isRequest(
  requestOrResponse: Request | Response,
): requestOrResponse is Request {
  return 'method' in requestOrResponse;
}

function requestMethod(requestOrResponse: Request | Response): string {
  return isRequest(requestOrResponse)
    ? requestOrResponse.method()
    : requestOrResponse.request().method();
}

test.describe('legacy admin frontend compatibility', () => {
  test('admin users loads and mutates through the legacy users contract', async ({
    adminPage,
  }) => {
    // Given: an injected ADMIN session and a synthetic auth seed database.
    const unifiedAccessRequests: string[] = [];
    adminPage.on('request', (request) => {
      if (e2eEnvironment.isUnifiedAccessPath(pathnameOf(request))) {
        unifiedAccessRequests.push(request.url());
      }
    });
    const listResponsePromise = adminPage.waitForResponse(
      (response) =>
        pathnameOf(response) === e2eEnvironment.legacyContracts.users &&
        requestMethod(response) === 'GET',
    );

    // When: the real browser opens the existing admin users page.
    await adminPage.goto('/admin/users');
    const listResponse = await listResponsePromise;

    // Then: the legacy list endpoint succeeds and renders synthetic users.
    expect(listResponse.status()).toBe(200);
    expect(pathnameOf(listResponse)).toBe(e2eEnvironment.legacyContracts.users);
    await expect(
      adminPage.getByRole('heading', { name: '사용자 관리' }),
    ).toBeVisible();
    const studentRow = adminPage
      .getByRole('row')
      .filter({ hasText: 'seed-auth-student-confirmed' });
    await expect(studentRow).toBeVisible();

    const mutationResponsePromise = adminPage.waitForResponse(
      (response) =>
        pathnameOf(response).startsWith(
          `${e2eEnvironment.legacyContracts.users}/`,
        ) &&
        pathnameOf(response).endsWith('/role') &&
        requestMethod(response) === 'PATCH',
    );

    // When: an administrator changes the synthetic student's role.
    await studentRow.getByRole('combobox').click();
    await adminPage
      .getByRole('option', { name: '교직원', exact: true })
      .click();
    const mutationResponse = await mutationResponsePromise;

    // Then: the legacy mutation endpoint remains authoritative after relocation.
    expect(mutationResponse.status()).toBe(200);
    await expect(adminPage.getByRole('status')).toContainText(
      '역할을 변경했습니다.',
    );

    const reloadResponsePromise = adminPage.waitForResponse(
      (response) =>
        pathnameOf(response) === e2eEnvironment.legacyContracts.users &&
        requestMethod(response) === 'GET',
    );

    // When: the administrator reloads the page in the same browser session.
    await adminPage.reload();
    const reloadResponse = await reloadResponsePromise;

    // Then: the persisted role is re-read from the legacy list endpoint.
    expect(reloadResponse.status()).toBe(200);
    await expect(studentRow).toContainText('교직원');
    expect(unifiedAccessRequests).toEqual([]);
  });

  test('staff requests loads and approves through the legacy role-requests contract', async ({
    adminPage,
  }) => {
    // Given: an injected ADMIN session and pending synthetic staff requests.
    const unifiedAccessRequests: string[] = [];
    adminPage.on('request', (request) => {
      if (e2eEnvironment.isUnifiedAccessPath(pathnameOf(request))) {
        unifiedAccessRequests.push(request.url());
      }
    });
    const listResponsePromise = adminPage.waitForResponse(
      (response) =>
        pathnameOf(response) === e2eEnvironment.legacyContracts.staffRequests &&
        requestMethod(response) === 'GET',
    );

    // When: the real browser opens the existing staff requests page.
    await adminPage.goto('/admin/staff-requests');
    const listResponse = await listResponsePromise;

    // Then: the exact legacy query contract succeeds and renders fixtures.
    expect(listResponse.status()).toBe(200);
    const listUrl = new URL(listResponse.url());
    expect(listUrl.searchParams.get('requestedRole')).toBe('STAFF');
    expect(listUrl.searchParams.get('status')).toBe('PENDING');
    await expect(
      adminPage.getByRole('heading', { name: '교직원 승인 관리' }),
    ).toBeVisible();
    const pendingRow = adminPage
      .getByRole('row')
      .filter({ hasText: 'seed-auth-staff-pending-second' });
    await expect(pendingRow).toBeVisible();

    const mutationResponsePromise = adminPage.waitForResponse(
      (response) =>
        pathnameOf(response).startsWith(
          `${e2eEnvironment.legacyContracts.staffRequests}/`,
        ) && requestMethod(response) === 'PATCH',
    );

    // When: the administrator approves the pending synthetic request.
    await pendingRow.getByRole('button', { name: '승인' }).click();
    const mutationResponse = await mutationResponsePromise;

    // Then: the legacy decision endpoint succeeds without using PR04 access APIs.
    expect(mutationResponse.status()).toBe(200);
    await expect(
      adminPage.getByRole('alert').filter({ hasText: '요청을 승인했습니다.' }),
    ).toBeVisible();

    const reloadResponsePromise = adminPage.waitForResponse(
      (response) =>
        pathnameOf(response) === e2eEnvironment.legacyContracts.staffRequests &&
        requestMethod(response) === 'GET',
    );

    // When: the administrator reloads the pending queue in the same session.
    await adminPage.reload();
    const reloadResponse = await reloadResponsePromise;

    // Then: the approval persisted server-side, so the row left the pending queue.
    expect(reloadResponse.status()).toBe(200);
    expect(new URL(reloadResponse.url()).searchParams.get('status')).toBe(
      'PENDING',
    );
    await expect(
      adminPage.getByRole('link', {
        name: 'seed-auth-staff-pending',
        exact: true,
      }),
    ).toBeVisible();
    await expect(pendingRow).toHaveCount(0);
    expect(unifiedAccessRequests).toEqual([]);
  });
});
