import { createHmac } from 'node:crypto';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { GithubWebhookConfig } from './github-webhook.config';
import { GithubWebhookRepository } from './github-webhook.repository';
import { GithubWebhookService } from './github-webhook.service';

const syntheticSecret = 'synthetic-observation-secret';
const syntheticOrg = 'JNU-SWCU';
const syntheticDeliveryId = '00000000-0000-4000-8000-000000000215';
const receivedAt = new Date('2026-07-23T00:00:00.000Z');

function buildService(): {
  readonly service: GithubWebhookService;
  readonly persist: jest.Mock;
  readonly observe: jest.Mock;
} {
  const persist = jest.fn();
  const observe = jest.fn().mockResolvedValue(undefined);
  const config = {
    targetOrg: syntheticOrg,
    webhookSecret: syntheticSecret,
  } satisfies Pick<GithubWebhookConfig, 'targetOrg' | 'webhookSecret'>;
  const repository = { persist, observe } satisfies Pick<
    GithubWebhookRepository,
    'persist' | 'observe'
  >;
  return {
    service: new GithubWebhookService(config, repository),
    persist,
    observe,
  };
}

function request(rawBody: Buffer, eventType: string) {
  const digest = createHmac('sha256', syntheticSecret)
    .update(rawBody)
    .digest('hex');
  return {
    rawBody,
    signature: `sha256=${digest}`,
    deliveryId: syntheticDeliveryId,
    eventType,
    receivedAt,
  };
}

describe('GithubWebhookService observation', () => {
  it('검증된 미구독 event는 IGNORED 관측만 남긴다', async () => {
    // Given
    const body = Buffer.from('not-json', 'utf8');
    const { service, persist, observe } = buildService();

    // When
    const result = await service.handle(request(body, 'issues'));

    // Then
    expect(result).toEqual({ outcome: 'ignored' });
    expect(persist).not.toHaveBeenCalled();
    expect(observe).toHaveBeenCalledWith({
      deliveryId: syntheticDeliveryId,
      eventType: 'issues',
      receivedAt,
      outcome: 'IGNORED',
    });
  });

  it('검증된 잘못된 payload는 공개 가능한 error code로 FAILED를 남긴다', async () => {
    // Given
    const body = Buffer.from(
      JSON.stringify({ organization: { login: syntheticOrg } }),
      'utf8',
    );
    const { service, observe } = buildService();

    // When
    const promise = service.handle(request(body, 'push'));

    // Then
    await expect(promise).rejects.toBeInstanceOf(BadRequestException);
    expect(observe).toHaveBeenCalledWith({
      deliveryId: syntheticDeliveryId,
      eventType: 'push',
      receivedAt,
      outcome: 'FAILED',
      errorCode: 'COL_WEBHOOK_INVALID_PAYLOAD',
    });
  });

  it('서명 검증 실패는 관측 행도 만들지 않는다', async () => {
    // Given
    const body = Buffer.from('not-json', 'utf8');
    const { service, persist, observe } = buildService();

    // When
    const promise = service.handle({
      ...request(body, 'push'),
      signature:
        'sha256=0000000000000000000000000000000000000000000000000000000000000000',
    });

    // Then
    await expect(promise).rejects.toBeInstanceOf(UnauthorizedException);
    expect(persist).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
  });

  it('activity 저장 실패는 FAILED 관측 뒤 원래 오류를 전파한다', async () => {
    // Given
    const body = Buffer.from(
      JSON.stringify({
        after: '1111111111111111111111111111111111111111',
        size: 1,
        organization: { login: syntheticOrg },
        repository: {
          id: 123456789,
          full_name: `${syntheticOrg}/synthetic-repository`,
          private: true,
          archived: false,
          pushed_at: 1_768_992_000,
        },
        head_commit: { timestamp: '2026-01-21T08:00:00.000Z' },
      }),
      'utf8',
    );
    const { service, persist, observe } = buildService();
    const databaseError = new Error('synthetic database failure');
    persist.mockRejectedValue(databaseError);

    // When
    const promise = service.handle(request(body, 'push'));

    // Then
    await expect(promise).rejects.toBe(databaseError);
    expect(observe).toHaveBeenCalledWith({
      deliveryId: syntheticDeliveryId,
      eventType: 'push',
      receivedAt,
      outcome: 'FAILED',
      errorCode: 'COL_WEBHOOK_PROCESSING_FAILED',
    });
  });
});
