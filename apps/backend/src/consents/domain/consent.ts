/** 세션 githubId로 식별된 동의 주체 — 이 모듈은 내부 사용자 id만 필요로 한다. */
export interface ConsentUser {
  id: string;
}

/** 저장된 전역 동의 한 건. append-only — UPDATE/DELETE 없이 버전별 행만 쌓인다. */
export interface ConsentRecord {
  policyVersion: string;
  consentedAt: Date;
}
