import type {
  AcceptConsentRequest,
  AcceptedConsent,
  ConsentApiErrorKind,
  CurrentConsent,
} from './api';

export type ConsentFlowState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly policy: CurrentConsent;
      readonly acceptedKeys: ReadonlySet<string>;
      readonly notice?: 'policy-updated';
    }
  | {
      readonly kind: 'submitting';
      readonly policy: CurrentConsent;
      readonly acceptedKeys: ReadonlySet<string>;
    }
  | { readonly kind: 'redirecting'; readonly nextUrl: string }
  | {
      readonly kind: 'error';
      readonly phase: 'load';
      readonly message: string;
    }
  | {
      readonly kind: 'error';
      readonly phase: 'submit';
      readonly policy: CurrentConsent;
      readonly acceptedKeys: ReadonlySet<string>;
      readonly message: string;
    }
  | {
      readonly kind: 'refreshing';
      readonly policy: CurrentConsent;
      readonly acceptedKeys: ReadonlySet<string>;
    };

export interface ConsentSubmission {
  readonly state: Extract<ConsentFlowState, { readonly kind: 'submitting' }>;
  readonly request: AcceptConsentRequest;
}

export interface ConsentFailureResult {
  readonly state: ConsentFlowState;
  readonly navigation: {
    readonly kind: 'full-page';
    readonly target: '/';
  } | null;
}

export function createConsentRequest(
  policy: CurrentConsent,
  acceptedKeys: ReadonlySet<string>,
): AcceptConsentRequest | null {
  const requiredKeys = policy.requiredItems.map((item) => item.key);
  const isComplete =
    requiredKeys.length > 0 &&
    acceptedKeys.size === requiredKeys.length &&
    requiredKeys.every((key) => acceptedKeys.has(key));

  return isComplete
    ? { policyVersion: policy.policyVersion, acceptedItems: requiredKeys }
    : null;
}

export function applyCurrentConsent(policy: CurrentConsent): ConsentFlowState {
  return policy.consented
    ? { kind: 'redirecting', nextUrl: policy.nextUrl }
    : { kind: 'ready', policy, acceptedKeys: new Set() };
}

function submissionFor(
  policy: CurrentConsent,
  acceptedKeys: ReadonlySet<string>,
): ConsentSubmission | null {
  const request = createConsentRequest(policy, acceptedKeys);
  return request
    ? {
        state: { kind: 'submitting', policy, acceptedKeys },
        request,
      }
    : null;
}

export function startConsentSubmission(
  state: ConsentFlowState,
): ConsentSubmission | null {
  switch (state.kind) {
    case 'ready':
      return submissionFor(state.policy, state.acceptedKeys);
    case 'error':
      switch (state.phase) {
        case 'submit':
          return submissionFor(state.policy, state.acceptedKeys);
        case 'load':
          return null;
        default: {
          const exhaustive: never = state;
          return exhaustive;
        }
      }
    case 'loading':
    case 'submitting':
    case 'redirecting':
    case 'refreshing':
      return null;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

export function applyAcceptedConsent(
  response: AcceptedConsent,
): ConsentFlowState {
  return { kind: 'redirecting', nextUrl: response.nextUrl };
}

export function applyConsentFailure(
  state: ConsentFlowState,
  failureKind: ConsentApiErrorKind,
  message: string,
): ConsentFailureResult {
  switch (failureKind) {
    case 'unauthorized':
      return {
        state,
        navigation: { kind: 'full-page', target: '/' },
      };
    case 'stale':
      return {
        state:
          state.kind === 'submitting'
            ? {
                kind: 'refreshing',
                policy: state.policy,
                acceptedKeys: state.acceptedKeys,
              }
            : state,
        navigation: null,
      };
    case 'validation':
    case 'generic':
      return {
        state:
          state.kind === 'submitting'
            ? {
                kind: 'error',
                phase: 'submit',
                policy: state.policy,
                acceptedKeys: state.acceptedKeys,
                message,
              }
            : state,
        navigation: null,
      };
    default: {
      const exhaustive: never = failureKind;
      return exhaustive;
    }
  }
}

export function applyRefreshedConsent(
  state: ConsentFlowState,
  policy: CurrentConsent,
): ConsentFlowState {
  if (policy.consented) {
    return { kind: 'redirecting', nextUrl: policy.nextUrl };
  }
  if (state.kind !== 'refreshing') {
    return applyCurrentConsent(policy);
  }

  const latestKeys = new Set(policy.requiredItems.map((item) => item.key));
  const priorKeys = new Set(state.policy.requiredItems.map((item) => item.key));
  const policyChanged =
    state.policy.policyVersion !== policy.policyVersion ||
    latestKeys.size !== priorKeys.size ||
    [...latestKeys].some((key) => !priorKeys.has(key));

  return policyChanged
    ? {
        kind: 'ready',
        policy,
        acceptedKeys: new Set(),
        notice: 'policy-updated',
      }
    : {
        kind: 'ready',
        policy,
        acceptedKeys: new Set(
          [...state.acceptedKeys].filter((key) => latestKeys.has(key)),
        ),
      };
}

function toggledKeys(
  policy: CurrentConsent,
  acceptedKeys: ReadonlySet<string>,
  key: string,
): ReadonlySet<string> {
  if (!policy.requiredItems.some((item) => item.key === key)) {
    return acceptedKeys;
  }
  const next = new Set(acceptedKeys);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

export function toggleConsentSelection(
  state: ConsentFlowState,
  key: string,
): ConsentFlowState {
  switch (state.kind) {
    case 'ready':
      return {
        ...state,
        acceptedKeys: toggledKeys(state.policy, state.acceptedKeys, key),
      };
    case 'error':
      switch (state.phase) {
        case 'submit':
          return {
            ...state,
            acceptedKeys: toggledKeys(state.policy, state.acceptedKeys, key),
          };
        case 'load':
          return state;
        default: {
          const exhaustive: never = state;
          return exhaustive;
        }
      }
    case 'loading':
    case 'submitting':
    case 'redirecting':
    case 'refreshing':
      return state;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}
