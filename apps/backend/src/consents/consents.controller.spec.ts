import { AuthenticatedRequest } from '../auth/session.guard';
import { ConsentsController } from './consents.controller';
import { ConsentsService } from './consents.service';
import { CURRENT_CONSENT_POLICY } from './domain/consent-policy';

// 합성 데이터만 사용한다 (docs/rules/security.md)
const syntheticGithubId = 424242n;
const request = {
  sessionGithubId: syntheticGithubId,
} as AuthenticatedRequest;

describe('ConsentsController.getCurrent', () => {
  it('티켓 #99 계약 형태(policyVersion/requiredItems/consented/nextUrl)로 응답한다', async () => {
    const getCurrent = jest.fn().mockResolvedValue({
      policy: CURRENT_CONSENT_POLICY,
      consented: false,
    });
    const controller = new ConsentsController({
      getCurrent,
    } as unknown as ConsentsService);

    const response = await controller.getCurrent(request);

    expect(getCurrent).toHaveBeenCalledWith(syntheticGithubId);
    expect(response).toEqual({
      policyVersion: '2026-01',
      requiredItems: [
        {
          key: 'PRIVACY_COLLECTION',
          label: '개인정보 수집·이용',
          documentUrl: '/policies/privacy/2026-01',
        },
        {
          key: 'GITHUB_ACTIVITY',
          label: 'GitHub 활동 수집·공개 범위',
          documentUrl: '/policies/github-activity/2026-01',
        },
      ],
      consented: false,
      nextUrl: '/onboarding/role',
    });
  });
});

describe('ConsentsController.create', () => {
  it('동의 저장 결과를 consentedAt ISO 문자열과 nextUrl로 직렬화한다', async () => {
    const accept = jest.fn().mockResolvedValue({
      policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
      consentedAt: new Date('2026-07-19T01:00:00.000Z'),
      nextUrl: CURRENT_CONSENT_POLICY.nextUrl,
    });
    const controller = new ConsentsController({
      accept,
    } as unknown as ConsentsService);

    const response = await controller.create(request, {
      policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
      acceptedItems: ['PRIVACY_COLLECTION', 'GITHUB_ACTIVITY'],
    });

    expect(accept).toHaveBeenCalledWith(syntheticGithubId, {
      policyVersion: CURRENT_CONSENT_POLICY.policyVersion,
      acceptedItems: ['PRIVACY_COLLECTION', 'GITHUB_ACTIVITY'],
    });
    expect(response).toEqual({
      policyVersion: '2026-01',
      consentedAt: '2026-07-19T01:00:00.000Z',
      nextUrl: '/onboarding/role',
    });
  });
});
