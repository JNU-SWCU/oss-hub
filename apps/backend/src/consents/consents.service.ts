import { Injectable } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { DomainException } from '../common/error-code';
import {
  CONSENT_ERROR_CODES,
  ConsentErrorCode,
} from './consent-error-code.enum';
import { ConsentsRepository } from './consents.repository';
import { ConsentRecord, ConsentUser } from './domain/consent';
import { ConsentPolicy, CURRENT_CONSENT_POLICY } from './domain/consent-policy';

export interface ConsentStatus {
  policy: ConsentPolicy;
  consented: boolean;
}

export interface ConsentGrant {
  policyVersion: string;
  consentedAt: Date;
  nextUrl: string;
}

export interface AcceptConsentInput {
  policyVersion: string;
  acceptedItems: string[];
}

@Injectable()
export class ConsentsService {
  constructor(private readonly repository: ConsentsRepository) {}

  async getCurrent(githubId: bigint): Promise<ConsentStatus> {
    const user = await this.requireUser(githubId);
    const consent = await this.repository.findConsent(
      user.id,
      CURRENT_CONSENT_POLICY.policyVersion,
    );
    return { policy: CURRENT_CONSENT_POLICY, consented: consent !== null };
  }

  /** 역할 온보딩 등 후속 도메인이 현행 동의 선행조건을 중복 조회하지 않게 한다. */
  async requireCurrent(githubId: bigint): Promise<void> {
    const consent = await this.getCurrent(githubId);
    if (!consent.consented) {
      throw new DomainException(
        CONSENT_ERROR_CODES[ConsentErrorCode.REQUIRED_CONSENT_MISSING],
      );
    }
  }

  /**
   * 현행 정책 버전에 대한 1회 동의를 저장한다. 과거 버전만 동의한 사용자도
   * 새 버전 행을 추가로 만든다 — 과거 동의는 삭제하지 않는다(append-only).
   */
  async accept(
    githubId: bigint,
    input: AcceptConsentInput,
  ): Promise<ConsentGrant> {
    const user = await this.requireUser(githubId);

    if (input.policyVersion !== CURRENT_CONSENT_POLICY.policyVersion) {
      throw new DomainException(
        CONSENT_ERROR_CODES[ConsentErrorCode.POLICY_VERSION_STALE],
      );
    }

    const accepted = new Set(input.acceptedItems);
    const hasExactRequiredItems =
      input.acceptedItems.length ===
        CURRENT_CONSENT_POLICY.requiredItems.length &&
      CURRENT_CONSENT_POLICY.requiredItems.every((item) =>
        accepted.has(item.key),
      );
    if (!hasExactRequiredItems) {
      throw new DomainException(
        CONSENT_ERROR_CODES[ConsentErrorCode.REQUIRED_CONSENT_MISSING],
      );
    }

    const consent: ConsentRecord = await this.repository.createConsent(
      user.id,
      CURRENT_CONSENT_POLICY.policyVersion,
    );
    return {
      policyVersion: consent.policyVersion,
      consentedAt: consent.consentedAt,
      nextUrl: CURRENT_CONSENT_POLICY.nextUrl,
    };
  }

  /** 세션은 유효하지만 사용자 행이 없으면 재로그인 대상이다 — 401로 수렴시킨다. */
  private async requireUser(githubId: bigint): Promise<ConsentUser> {
    const user = await this.repository.findUserByGithubId(githubId);
    if (!user || user.accountStatus !== AccountStatus.ACTIVE) {
      throw new DomainException(
        CONSENT_ERROR_CODES[ConsentErrorCode.UNAUTHENTICATED],
      );
    }
    return user;
  }
}
