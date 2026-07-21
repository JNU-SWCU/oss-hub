import { expect, test } from 'vitest';

import type { AcceptedConsent, CurrentConsent } from './api';
import {
  applyAcceptedConsent,
  applyConsentFailure,
  applyCurrentConsent,
  applyRefreshedConsent,
  createConsentRequest,
  startConsentSubmission,
  toggleConsentSelection,
  type ConsentFlowState,
} from './consent-state';

const currentPolicy: CurrentConsent = {
  policyVersion: 'policy-test-v2',
  requiredItems: [
    { key: 'ALPHA', label: '첫 번째 항목', documentUrl: '/policies/alpha' },
    { key: 'BETA', label: '두 번째 항목', documentUrl: '/policies/beta' },
  ],
  consented: false,
  nextUrl: '/next-from-server',
};

test.each([
  new Set<string>(),
  new Set(['ALPHA']),
  new Set(['ALPHA', 'BETA', 'EXTRA']),
])('0개·부분·초과 선택은 제출 요청을 만들지 않는다', (acceptedKeys) => {
  expect(createConsentRequest(currentPolicy, acceptedKeys)).toBeNull();
});

test('서버가 세 번째 필수 약관을 추가하면 세 항목 모두 선택해야 제출한다', () => {
  const policyWithOrgTerms: CurrentConsent = {
    ...currentPolicy,
    requiredItems: [
      ...currentPolicy.requiredItems,
      {
        key: 'ORG_REPOSITORY_TERMS',
        label: 'Org 저장소 운영 약관',
        documentUrl: '/policies/org-repository-terms/2026-07-21.html',
      },
    ],
  };

  expect(
    createConsentRequest(policyWithOrgTerms, new Set(['ALPHA', 'BETA'])),
  ).toBeNull();
  expect(
    createConsentRequest(
      policyWithOrgTerms,
      new Set(['ALPHA', 'BETA', 'ORG_REPOSITORY_TERMS']),
    ),
  ).toEqual({
    policyVersion: 'policy-test-v2',
    acceptedItems: ['ALPHA', 'BETA', 'ORG_REPOSITORY_TERMS'],
  });
});

test('현재 동의 여부에 따라 빈 ready 또는 응답 경로 redirecting을 만든다', () => {
  expect(applyCurrentConsent(currentPolicy)).toEqual({
    kind: 'ready',
    policy: currentPolicy,
    acceptedKeys: new Set(),
  });

  const consentedPolicy: CurrentConsent = {
    ...currentPolicy,
    consented: true,
  };
  expect(applyCurrentConsent(consentedPolicy)).toEqual({
    kind: 'redirecting',
    nextUrl: '/next-from-server',
  });
});

test('완전한 ready만 submitting으로 전환하고 진행 중 재호출은 거부한다', () => {
  const ready: ConsentFlowState = {
    kind: 'ready',
    policy: currentPolicy,
    acceptedKeys: new Set(['ALPHA', 'BETA']),
  };

  const first = startConsentSubmission(ready);

  expect(first).toEqual({
    state: {
      kind: 'submitting',
      policy: currentPolicy,
      acceptedKeys: new Set(['ALPHA', 'BETA']),
    },
    request: {
      policyVersion: 'policy-test-v2',
      acceptedItems: ['ALPHA', 'BETA'],
    },
  });
  expect(first && startConsentSubmission(first.state)).toBeNull();
  expect(
    startConsentSubmission({
      kind: 'ready',
      policy: currentPolicy,
      acceptedKeys: new Set(['ALPHA']),
    }),
  ).toBeNull();
});

test('성공 응답의 nextUrl만 redirecting 상태에 전달한다', () => {
  const response: AcceptedConsent = {
    policyVersion: 'policy-test-v2',
    consentedAt: '2026-07-21T00:00:00.000Z',
    nextUrl: '/destination-from-response',
  };

  expect(applyAcceptedConsent(response)).toEqual({
    kind: 'redirecting',
    nextUrl: '/destination-from-response',
  });
});

test('stale 후 정책 버전이나 항목이 바뀌면 선택을 초기화하고 자동 제출하지 않는다', () => {
  const refreshing: ConsentFlowState = {
    kind: 'refreshing',
    policy: currentPolicy,
    acceptedKeys: new Set(['ALPHA', 'BETA']),
  };
  const changedPolicy: CurrentConsent = {
    policyVersion: 'policy-test-v3',
    requiredItems: [
      ...currentPolicy.requiredItems,
      { key: 'GAMMA', label: '새 항목', documentUrl: '/policies/gamma' },
    ],
    consented: false,
    nextUrl: '/changed-next-from-server',
  };

  const result = applyRefreshedConsent(refreshing, changedPolicy);

  expect(result).toEqual({
    kind: 'ready',
    policy: changedPolicy,
    acceptedKeys: new Set(),
    notice: 'policy-updated',
  });
  expect(startConsentSubmission(result)).toBeNull();
});

test('stale 후 같은 정책이면 적용 가능한 선택을 보존한다', () => {
  const refreshing: ConsentFlowState = {
    kind: 'refreshing',
    policy: currentPolicy,
    acceptedKeys: new Set(['ALPHA']),
  };

  expect(applyRefreshedConsent(refreshing, currentPolicy)).toEqual({
    kind: 'ready',
    policy: currentPolicy,
    acceptedKeys: new Set(['ALPHA']),
  });
});

test.each(['validation', 'generic'] as const)(
  '%s 실패는 적용 가능한 선택을 보존하고 명시적 재시도를 허용한다',
  (failureKind) => {
    const submitting: ConsentFlowState = {
      kind: 'submitting',
      policy: currentPolicy,
      acceptedKeys: new Set(['ALPHA', 'BETA']),
    };

    const result = applyConsentFailure(
      submitting,
      failureKind,
      '다시 시도해 주세요.',
    );

    expect(result.navigation).toBeNull();
    expect(result.state).toEqual({
      kind: 'error',
      phase: 'submit',
      policy: currentPolicy,
      acceptedKeys: new Set(['ALPHA', 'BETA']),
      message: '다시 시도해 주세요.',
    });
    expect(startConsentSubmission(result.state)).toEqual({
      state: {
        kind: 'submitting',
        policy: currentPolicy,
        acceptedKeys: new Set(['ALPHA', 'BETA']),
      },
      request: {
        policyVersion: 'policy-test-v2',
        acceptedItems: ['ALPHA', 'BETA'],
      },
    });
  },
);

test('401 실패는 세션 초기화를 위한 전체 루트 내비게이션을 결정한다', () => {
  const submitting: ConsentFlowState = {
    kind: 'submitting',
    policy: currentPolicy,
    acceptedKeys: new Set(['ALPHA', 'BETA']),
  };

  expect(
    applyConsentFailure(submitting, 'unauthorized', '인증이 필요합니다.'),
  ).toEqual({
    state: submitting,
    navigation: { kind: 'full-page', target: '/' },
  });
});

test('409 실패는 refreshing으로 전환하고 이전 payload를 제출하지 않는다', () => {
  const submitting: ConsentFlowState = {
    kind: 'submitting',
    policy: currentPolicy,
    acceptedKeys: new Set(['ALPHA', 'BETA']),
  };

  expect(
    applyConsentFailure(submitting, 'stale', '정책이 바뀌었습니다.'),
  ).toEqual({
    state: {
      kind: 'refreshing',
      policy: currentPolicy,
      acceptedKeys: new Set(['ALPHA', 'BETA']),
    },
    navigation: null,
  });
});

test('오류 상태에서도 해당 정책 항목만 토글하며 알 수 없는 key는 무시한다', () => {
  const state: ConsentFlowState = {
    kind: 'error',
    phase: 'submit',
    policy: currentPolicy,
    acceptedKeys: new Set(['ALPHA']),
    message: '합성 오류',
  };

  const toggled = toggleConsentSelection(state, 'BETA');

  expect(toggled).toEqual({
    ...state,
    acceptedKeys: new Set(['ALPHA', 'BETA']),
  });
  expect(toggleConsentSelection(toggled, 'UNKNOWN')).toEqual(toggled);
});
