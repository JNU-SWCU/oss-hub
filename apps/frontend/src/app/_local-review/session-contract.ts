function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Keep the development-only legacy personas on the canonical session wire shape. */
export function canonicalLocalReviewSessionBody(
  path: string,
  body: unknown,
): unknown {
  if (path !== 'auth/session' || !isRecord(body) || !isRecord(body.user)) {
    return body;
  }

  const role = body.user.role;
  if (
    role !== null &&
    role !== 'STUDENT' &&
    role !== 'STAFF' &&
    role !== 'ADMIN'
  ) {
    return body;
  }
  return {
    ...body,
    user: {
      ...body.user,
      memberKind: role === 'STUDENT' || role === 'STAFF' ? role : null,
      hasStaffAccess: role === 'STAFF',
      hasAdminAccess: role === 'ADMIN',
    },
  };
}
