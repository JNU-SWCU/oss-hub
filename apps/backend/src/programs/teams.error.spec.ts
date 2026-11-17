import {
  APPLICATIONS_ERROR_CODES,
  ApplicationsErrorCode,
  repositoryUrlError,
} from './teams.error';

const REPOSITORY_URL_ERROR_KINDS = [
  'closed',
  'conflict',
  'busy',
  'unavailable',
] as const satisfies readonly Parameters<typeof repositoryUrlError>[0][];

const KNOWN_SHARED_CODES = ['APP_028', 'APP_029'];

describe('application error codes', () => {
  const registrations = [
    ...Object.values(APPLICATIONS_ERROR_CODES),
    ...REPOSITORY_URL_ERROR_KINDS.map(
      (kind) => repositoryUrlError(kind).errorCode,
    ),
  ];

  it('registers each distinct enum code under its own key', () => {
    const codes = Object.values(ApplicationsErrorCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(APPLICATIONS_ERROR_CODES[code].code).toBe(code);
    }
  });

  it('gives every APP registration its own public code except the known shared ones', () => {
    const counts = new Map<string, number>();
    for (const { code } of registrations) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }

    const shared = [...counts]
      .filter(([, count]) => count > 1)
      .map(([code]) => code)
      .sort();

    expect(shared).toEqual(KNOWN_SHARED_CODES);
  });

  it('keeps the repository provisioning retry conflict apart from the GitHub lookup failure', () => {
    const retry =
      APPLICATIONS_ERROR_CODES[
        ApplicationsErrorCode.REPOSITORY_PROVISION_NOT_RETRYABLE
      ];
    const unavailable = repositoryUrlError('unavailable').errorCode;

    expect(retry).toMatchObject({ code: 'APP_037', status: 409 });
    expect(unavailable).toMatchObject({ code: 'APP_036', status: 503 });
  });
});
