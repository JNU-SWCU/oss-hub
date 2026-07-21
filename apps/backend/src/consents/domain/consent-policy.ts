/**
 * 현행 전역 개인정보·활동 동의 정책(#99).
 *
 * 정책 버전의 production SSOT는 consent 도메인이 소유하는 이 leaf 상수다.
 * 시드는 이 값을 import하며, 정책이 개정되어도 과거 Consent 행은
 * 삭제하지 않는다(append-only, schema 계약).
 */
export const CONSENT_POLICY_VERSION = '2026-07-21';

export const CONSENT_ITEM_KEYS = {
  PRIVACY_COLLECTION: 'PRIVACY_COLLECTION',
  GITHUB_ACTIVITY: 'GITHUB_ACTIVITY',
  ORG_REPOSITORY_TERMS: 'ORG_REPOSITORY_TERMS',
} as const;

export type ConsentItemKey =
  (typeof CONSENT_ITEM_KEYS)[keyof typeof CONSENT_ITEM_KEYS];

export interface ConsentRequiredItem {
  key: ConsentItemKey;
  label: string;
  documentUrl: string;
}

export interface ConsentPolicy {
  policyVersion: string;
  requiredItems: readonly ConsentRequiredItem[];
  /** 동의 완료(또는 이미 동의) 후 이동할 경로 — #107 역할 선택. */
  nextUrl: string;
}

export const CURRENT_CONSENT_POLICY: ConsentPolicy = {
  policyVersion: CONSENT_POLICY_VERSION,
  requiredItems: [
    {
      key: CONSENT_ITEM_KEYS.PRIVACY_COLLECTION,
      label: '개인정보 수집·이용',
      documentUrl: `/policies/privacy/${CONSENT_POLICY_VERSION}.html`,
    },
    {
      key: CONSENT_ITEM_KEYS.GITHUB_ACTIVITY,
      label: 'GitHub 활동 수집·공개 범위',
      documentUrl: `/policies/github-activity/${CONSENT_POLICY_VERSION}.html`,
    },
    {
      key: CONSENT_ITEM_KEYS.ORG_REPOSITORY_TERMS,
      label: 'Org 저장소 운영 약관',
      documentUrl: `/policies/org-repository-terms/${CONSENT_POLICY_VERSION}.html`,
    },
  ],
  nextUrl: '/onboarding/role',
};
