import { describe, expect, it } from 'vitest';
import { dashboardFixture } from '@/features/dashboard/fixtures';
import { resolveLocalReviewResponse } from './fixture-response';
import type { LocalReviewFixtureId } from './fixture-contract';

function sessionFor(fixture: LocalReviewFixtureId) {
  return resolveLocalReviewResponse({
    fixture,
    method: 'GET',
    path: 'auth/session',
    searchParams: new URLSearchParams(),
  });
}

describe('local review fixture responses', () => {
  it('anonymous fixture returns the public unauthenticated session', () => {
    // Given
    const fixture = 'anonymous';

    // When
    const response = sessionFor(fixture);

    // Then
    expect(response).toEqual({
      kind: 'json',
      status: 200,
      body: { isAuthenticated: false },
    });
  });

  it.each([
    ['student', 'STUDENT'],
    ['staff', 'STAFF'],
    ['admin', 'ADMIN'],
    ['settings', 'STUDENT'],
    ['wrong-role', 'STUDENT'],
  ] as const)('%s fixture exposes only its synthetic role', (fixture, role) => {
    // Given / When
    const response = sessionFor(fixture);

    // Then
    expect(response).toMatchObject({
      kind: 'json',
      status: 200,
      body: {
        isAuthenticated: true,
        user: { role },
      },
    });
  });

  it('unassigned fixture has no role and no role request', () => {
    // Given / When
    const session = sessionFor('unassigned');
    const roleRequest = resolveLocalReviewResponse({
      fixture: 'unassigned',
      method: 'GET',
      path: 'role-requests/me',
      searchParams: new URLSearchParams(),
    });

    // Then
    expect(session).toMatchObject({
      kind: 'json',
      body: {
        isAuthenticated: true,
        user: { role: null },
      },
    });
    expect(roleRequest).toEqual({ kind: 'json', status: 200, body: null });
  });

  it('loading and error fixtures remain distinguishable at the session boundary', () => {
    // Given / When
    const loading = sessionFor('loading');
    const error = sessionFor('error');

    // Then
    expect(loading).toEqual({ kind: 'delay', milliseconds: 60_000 });
    expect(error).toMatchObject({ kind: 'json', status: 503 });
  });

  it('student fixture reuses the dashboard synthetic data', () => {
    // Given / When
    const response = resolveLocalReviewResponse({
      fixture: 'student',
      method: 'GET',
      path: 'dashboard/student',
      searchParams: new URLSearchParams(),
    });

    // Then
    expect(response).toEqual({
      kind: 'json',
      status: 200,
      body: dashboardFixture,
    });
  });

  it('staff, admin, and settings fixtures expose their minimum page data', () => {
    // Given / When
    const staff = resolveLocalReviewResponse({
      fixture: 'staff',
      method: 'GET',
      path: 'dashboard/staff/summary',
      searchParams: new URLSearchParams(),
    });
    const admin = resolveLocalReviewResponse({
      fixture: 'admin',
      method: 'GET',
      path: 'role-requests',
      searchParams: new URLSearchParams('status=PENDING&page=1&limit=20'),
    });
    const profile = resolveLocalReviewResponse({
      fixture: 'settings',
      method: 'GET',
      path: 'users/me/profile',
      searchParams: new URLSearchParams(),
    });
    const notification = resolveLocalReviewResponse({
      fixture: 'settings',
      method: 'GET',
      path: 'users/me/notification-email',
      searchParams: new URLSearchParams(),
    });

    // Then
    expect(staff).toMatchObject({
      kind: 'json',
      body: { programs: expect.any(Array) },
    });
    expect(admin).toMatchObject({
      kind: 'json',
      body: { items: expect.any(Array), total: 1 },
    });
    expect(profile).toMatchObject({
      kind: 'json',
      body: { isComplete: true },
    });
    expect(notification).toMatchObject({
      kind: 'json',
      body: { notifyEnabled: true },
    });
  });

  it('admin fixture serves audit logs in the paginated backend shape', () => {
    // Given / When
    const response = resolveLocalReviewResponse({
      fixture: 'admin',
      method: 'GET',
      path: 'audit-logs',
      searchParams: new URLSearchParams('page=1&limit=2'),
    });

    // Then
    expect(response).toMatchObject({
      kind: 'json',
      status: 200,
      body: { total: 3, page: 1, limit: 2 },
    });
    expect(
      response.kind === 'json' &&
        (response.body as { items: readonly unknown[] }).items,
    ).toHaveLength(2);
  });

  it('audit log fixture applies the actor and action filters it is sent', () => {
    // Given / When
    const response = resolveLocalReviewResponse({
      fixture: 'admin',
      method: 'GET',
      path: 'audit-logs',
      searchParams: new URLSearchParams(
        'action=STAFF_ROLE_REQUEST_APPROVED&actor=SYNTHETIC-admin&page=1&limit=20',
      ),
    });

    // Then
    expect(response).toMatchObject({
      kind: 'json',
      body: {
        total: 1,
        items: [{ action: 'STAFF_ROLE_REQUEST_APPROVED' }],
      },
    });
  });

  it('unsupported paths fail closed instead of reaching the backend', () => {
    // Given / When
    const response = resolveLocalReviewResponse({
      fixture: 'student',
      method: 'POST',
      path: 'unknown',
      searchParams: new URLSearchParams(),
    });

    // Then
    expect(response).toMatchObject({ kind: 'json', status: 404 });
  });
});
