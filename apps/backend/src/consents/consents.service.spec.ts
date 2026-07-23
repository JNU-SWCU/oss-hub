import { AccountStatus } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { ConsentErrorCode } from './consent-error-code.enum';
import { ConsentsRepository } from './consents.repository';
import { ConsentsService } from './consents.service';
import { ConsentRecord } from './domain/consent';
import {
  CONSENT_ITEM_KEYS,
  CURRENT_CONSENT_POLICY,
} from './domain/consent-policy';

// 합성 데이터만 사용한다 (docs/rules/security.md)
const syntheticGithubId = 424242n;
const syntheticUserId = 'cuid-synthetic-consent-user';
const syntheticConsent: ConsentRecord = {
  policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
  consentedAt: new Date('2026-07-19T01:00:00.000Z'),
};

const allRequiredKeys = CURRENT_CONSENT_POLICY.requiredItems.map(
  (item) => item.key,
);

function buildService(overrides: Partial<ConsentsRepository> = {}): {
  service: ConsentsService;
  findUserByGithubId: jest.Mock;
  findConsent: jest.Mock;
  createConsent: jest.Mock;
} {
  const findUserByGithubId = jest.fn().mockResolvedValue({
    id: syntheticUserId,
    accountStatus: AccountStatus.ACTIVE,
  });
  const findConsent = jest.fn().mockResolvedValue(null);
  const createConsent = jest.fn().mockResolvedValue(syntheticConsent);
  const repository = {
    findUserByGithubId,
    findConsent,
    createConsent,
    ...overrides,
  } as unknown as ConsentsRepository;
  return {
    service: new ConsentsService(repository),
    findUserByGithubId,
    findConsent,
    createConsent,
  };
}

async function captureDomainException(
  run: () => Promise<unknown>,
): Promise<DomainException> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DomainException) {
      return error;
    }
    throw error;
  }
  throw new Error('DomainException이 발생해야 합니다.');
}

it('issue-99 exact accepted-item set', async () => {
  const { service, createConsent } = buildService();

  await expect(
    service.accept(syntheticGithubId, {
      policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
      acceptedItems: [...allRequiredKeys, 'UNRELATED_KEY'],
    }),
  ).rejects.toMatchObject({
    errorCode: { code: 'CON_003' },
  });
  expect(createConsent).not.toHaveBeenCalled();
});

describe('ConsentsService.getCurrent', () => {
  it('미동의 사용자는 consented=false와 현행 정책을 받는다', async () => {
    const { service, findConsent } = buildService();

    const status = await service.getCurrent(syntheticGithubId);

    expect(status.consented).toBe(false);
    expect(status.policy).toBe(CURRENT_CONSENT_POLICY);
    expect(status.policy.nextUrl).toBe('/onboarding/profile');
    expect(findConsent).toHaveBeenCalledWith(
      syntheticUserId,
      CURRENT_CONSENT_POLICY.policyVersion,
    );
  });

  it('현행 버전 동의가 있으면 consented=true다 — 재방문 자동 통과 근거', async () => {
    const { service } = buildService({
      findConsent: jest.fn().mockResolvedValue(syntheticConsent),
    });

    const status = await service.getCurrent(syntheticGithubId);

    expect(status.consented).toBe(true);
  });

  it('세션 githubId의 사용자 행이 없으면 401 CON_001을 던진다', async () => {
    const { service } = buildService({
      findUserByGithubId: jest.fn().mockResolvedValue(null),
    });

    const exception = await captureDomainException(() =>
      service.getCurrent(syntheticGithubId),
    );

    expect(exception.errorCode.code).toBe(ConsentErrorCode.UNAUTHENTICATED);
    expect(exception.errorCode.status).toBe(401);
  });

  it('비활성 계정은 사용자 행이 있어도 401 CON_001로 차단한다', async () => {
    const { service, findConsent } = buildService({
      findUserByGithubId: jest.fn().mockResolvedValue({
        id: syntheticUserId,
        accountStatus: AccountStatus.DEACTIVATED,
      }),
    });

    const exception = await captureDomainException(() =>
      service.getCurrent(syntheticGithubId),
    );

    expect(exception.errorCode.code).toBe(ConsentErrorCode.UNAUTHENTICATED);
    expect(findConsent).not.toHaveBeenCalled();
  });
});

describe('ConsentsService.requireCurrent', () => {
  it('현행 정책 동의가 있으면 후속 온보딩을 허용한다', async () => {
    const { service } = buildService({
      findConsent: jest.fn().mockResolvedValue(syntheticConsent),
    });

    await expect(service.requireCurrent(syntheticGithubId)).resolves.toBe(
      undefined,
    );
  });

  it('현행 정책 미동의 사용자는 422 CON_003으로 거부한다', async () => {
    const { service } = buildService();

    const exception = await captureDomainException(() =>
      service.requireCurrent(syntheticGithubId),
    );

    expect(exception.errorCode.code).toBe(
      ConsentErrorCode.REQUIRED_CONSENT_MISSING,
    );
    expect(exception.errorCode.status).toBe(422);
  });
});

describe('ConsentsService.accept', () => {
  it('현행 버전 + 필수 항목 전체 동의는 레코드를 만들고 nextUrl을 돌려준다', async () => {
    const { service, createConsent } = buildService();

    const grant = await service.accept(syntheticGithubId, {
      policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
      acceptedItems: allRequiredKeys,
    });

    expect(createConsent).toHaveBeenCalledWith(
      syntheticUserId,
      CURRENT_CONSENT_POLICY.policyVersion,
    );
    expect(grant).toEqual({
      policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
      consentedAt: syntheticConsent.consentedAt,
      nextUrl: '/onboarding/profile',
    });
  });

  it('acceptedItems 순서는 판정에 영향을 주지 않는다', async () => {
    const { service } = buildService();

    const grant = await service.accept(syntheticGithubId, {
      policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
      acceptedItems: [...allRequiredKeys].reverse(),
    });

    expect(grant.nextUrl).toBe('/onboarding/profile');
  });

  it('과거 policyVersion은 항목도 잘못됐을 때 409 CON_002를 우선한다', async () => {
    const { service, createConsent } = buildService();

    const exception = await captureDomainException(() =>
      service.accept(syntheticGithubId, {
        policyVersion: 'privacy-activity-consent-v0',
        acceptedItems: [...allRequiredKeys, 'UNRELATED_KEY'],
      }),
    );

    expect(exception.errorCode.code).toBe(
      ConsentErrorCode.POLICY_VERSION_STALE,
    );
    expect(exception.errorCode.status).toBe(409);
    expect(createConsent).not.toHaveBeenCalled();
  });

  it.each([
    ['빈 목록', []],
    ['일부 누락', [CONSENT_ITEM_KEYS.PRIVACY_COLLECTION]],
    ['다른 일부 누락', [CONSENT_ITEM_KEYS.GITHUB_ACTIVITY]],
    [
      'Org 저장소 운영 약관 누락',
      [CONSENT_ITEM_KEYS.PRIVACY_COLLECTION, CONSENT_ITEM_KEYS.GITHUB_ACTIVITY],
    ],
    ['무관한 키만', ['UNRELATED_KEY']],
  ])(
    '필수 항목 누락(%s)은 422 CON_003으로 거부하고 레코드를 만들지 않는다',
    async (_label, acceptedItems) => {
      const { service, createConsent } = buildService();

      const exception = await captureDomainException(() =>
        service.accept(syntheticGithubId, {
          policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
          acceptedItems: acceptedItems,
        }),
      );

      expect(exception.errorCode.code).toBe(
        ConsentErrorCode.REQUIRED_CONSENT_MISSING,
      );
      expect(exception.errorCode.status).toBe(422);
      expect(createConsent).not.toHaveBeenCalled();
    },
  );

  it('중복 항목은 422 CON_003으로 거부하고 레코드를 만들지 않는다', async () => {
    const { service, createConsent } = buildService();

    const exception = await captureDomainException(() =>
      service.accept(syntheticGithubId, {
        policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
        acceptedItems: [
          ...allRequiredKeys,
          CONSENT_ITEM_KEYS.PRIVACY_COLLECTION,
        ],
      }),
    );

    expect(exception.errorCode.code).toBe(
      ConsentErrorCode.REQUIRED_CONSENT_MISSING,
    );
    expect(exception.errorCode.status).toBe(422);
    expect(createConsent).not.toHaveBeenCalled();
  });

  it('세션 githubId의 사용자 행이 없으면 401 CON_001을 던진다', async () => {
    const { service } = buildService({
      findUserByGithubId: jest.fn().mockResolvedValue(null),
    });

    const exception = await captureDomainException(() =>
      service.accept(syntheticGithubId, {
        policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
        acceptedItems: allRequiredKeys,
      }),
    );

    expect(exception.errorCode.code).toBe(ConsentErrorCode.UNAUTHENTICATED);
  });
});
