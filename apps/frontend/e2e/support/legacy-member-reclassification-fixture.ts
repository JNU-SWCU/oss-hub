import type { Page } from '@playwright/test';
import {
  fulfillJson,
  fulfillProblem,
  RECLASSIFICATION_PATH,
  SESSION_PATH,
  TASK_10_BROWSER_TIMEOUT,
} from './legacy-member-reclassification-fixture-http';
import {
  authenticatedSession,
  type CapturedReclassification,
  type NextResult,
  parseReclassificationRequest,
  resolvedAdmin,
  sameReclassificationRequest,
  type SessionState,
  unresolvedLegacyAdmin,
} from './legacy-member-reclassification-fixture-state';

export { RECLASSIFICATION_PATH, SESSION_PATH, TASK_10_BROWSER_TIMEOUT };
export type { CapturedReclassification, SessionState };

export type LegacyMemberReclassificationFixture = {
  readonly attempts: () => readonly CapturedReclassification[];
  readonly canonical: () => CapturedReclassification | null;
  readonly replayCount: () => number;
  readonly nextReclassificationAttempt: () => number;
  readonly nextSessionSequence: () => number;
  readonly setNextResult: (result: NextResult) => void;
  readonly holdNextReclassification: () => { readonly release: () => void };
  readonly holdNextSession: () => { readonly release: () => void };
};

export async function installLegacyMemberReclassificationFixture(
  page: Page,
  options: {
    readonly canonical?: CapturedReclassification | null;
    readonly session?: SessionState;
  } = {},
): Promise<LegacyMemberReclassificationFixture> {
  let canonical = options.canonical ?? null;
  let session = options.session ?? unresolvedLegacyAdmin();
  let nextResult: NextResult = 'success';
  let reclassificationHold: Deferred<void> | null = null;
  let sessionHold: Deferred<void> | null = null;
  let sessionSequence = 0;
  let replayCount = 0;
  const attempts: CapturedReclassification[] = [];

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === SESSION_PATH) {
      sessionSequence += 1;
      const hold = sessionHold;
      sessionHold = null;
      if (hold !== null) await hold.promise;
      const headers = {
        'x-task10-session-sequence': String(sessionSequence),
      };
      if (session.kind === 'error') {
        await fulfillProblem(route, 500, 'Synthetic session failure', headers);
        return;
      }
      await fulfillJson(
        route,
        session.kind === 'anonymous'
          ? { isAuthenticated: false, user: null }
          : authenticatedSession(session),
        200,
        headers,
      );
      return;
    }
    if (pathname === RECLASSIFICATION_PATH) {
      const parsed = parseReclassificationRequest(
        JSON.parse(request.postData() ?? 'null'),
      );
      attempts.push(parsed);
      const attempt = attempts.length;
      const hold = reclassificationHold;
      reclassificationHold = null;
      if (hold !== null) await hold.promise;
      const result = nextResult;
      nextResult = 'success';
      const headers = {
        'x-task10-reclassification-attempt': String(attempt),
      };
      if (result === 'malformed-success') {
        await fulfillJson(route, {}, 200, headers);
        return;
      }
      if (
        result === 'conflict' ||
        (canonical !== null && !sameReclassificationRequest(canonical, parsed))
      ) {
        await fulfillProblem(
          route,
          409,
          '이미 다른 회원 유형으로 저장되어 다시 변경할 수 없습니다.',
          headers,
        );
        return;
      }
      if (canonical === null) canonical = parsed;
      else replayCount += 1;
      session = resolvedAdmin(canonical);
      await fulfillJson(
        route,
        {
          memberKind: canonical.memberKind,
          hasStaffAccess: canonical.memberKind === 'STAFF',
          hasAdminAccess: true,
        },
        200,
        headers,
      );
      return;
    }
    if (pathname.endsWith('/dashboard/student')) {
      await fulfillJson(route, { items: [] });
      return;
    }
    if (pathname.endsWith('/dashboard/staff/summary')) {
      await fulfillJson(route, { programs: [] });
      return;
    }
    await fulfillJson(route, {});
  });

  return {
    attempts: () => attempts,
    canonical: () => canonical,
    replayCount: () => replayCount,
    nextReclassificationAttempt: () => attempts.length + 1,
    nextSessionSequence: () => sessionSequence + 1,
    setNextResult(result) {
      nextResult = result;
    },
    holdNextReclassification() {
      if (reclassificationHold !== null) {
        throw new Error('A reclassification response is already held');
      }
      const deferred = createDeferred<void>();
      reclassificationHold = deferred;
      return { release: () => deferred.resolve() };
    },
    holdNextSession() {
      if (sessionHold !== null) {
        throw new Error('A session response is already held');
      }
      const deferred = createDeferred<void>();
      sessionHold = deferred;
      return { release: () => deferred.resolve() };
    },
  };
}

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      if (resolvePromise === null) throw new Error('Deferred is not armed');
      resolvePromise(value);
    },
  };
}
