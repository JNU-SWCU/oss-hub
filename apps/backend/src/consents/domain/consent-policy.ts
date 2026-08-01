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
  // 동의 다음은 역할 선택이다. 프로필을 먼저 받으면 그 시점에 역할이 없어서 학생
  // 기준(가장 엄격)으로 판정되고, 학번이 필요 없는 교직원·관리자가 가짜 학번을
  // 지어내야 한다. 역할을 먼저 물어야 프로필이 역할에 맞는 항목만 요구할 수 있다.
  nextUrl: '/onboarding/role',
};
