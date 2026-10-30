import { Injectable } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import {
  CONSENT_ERROR_CODES,
  ConsentErrorCode,
} from './consent-error-code.error';
import { ConsentsRepository } from './member-onboarding.repository';
import {
  ConsentGrant,
  ConsentRecord,
  ConsentStatus,
  ConsentUser,
} from './users.types';
import {
  COMPATIBLE_CONSENT_POLICY_VERSIONS,
  CURRENT_CONSENT_POLICY,
} from './user-profile.policy';

export interface AcceptConsentInput {
  policyVersion: string;
  acceptedItems: string[];
}

@Injectable()
export class ConsentsService {
  constructor(private readonly repository: ConsentsRepository) {}

  async getCurrent(githubId: bigint): Promise<ConsentStatus> {
    const user = await this.requireUser(githubId);
    for (const policyVersion of [
      CURRENT_CONSENT_POLICY.policyVersion,
      ...COMPATIBLE_CONSENT_POLICY_VERSIONS,
    ]) {
      const consent = await this.repository.findConsent(user.id, policyVersion);
      if (consent) {
        return { policy: CURRENT_CONSENT_POLICY, consented: true };
      }
    }
    return { policy: CURRENT_CONSENT_POLICY, consented: false };
  }

  async requireCurrent(githubId: bigint): Promise<void> {
    const consent = await this.getCurrent(githubId);
    if (!consent.consented) {
      throw new DomainException(
        CONSENT_ERROR_CODES[ConsentErrorCode.REQUIRED_CONSENT_MISSING],
      );
    }
  }

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
