import { createHmac } from 'node:crypto';
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { GithubWebhookConfig } from './github-webhook.config';
import { GithubWebhookRepository } from './github-webhook.repository';
import { GithubWebhookService } from './github-webhook.service';

const syntheticSecret = 'synthetic-webhook-secret';
const syntheticOrg = 'JNU-SWCU';
const syntheticDeliveryId = '00000000-0000-4000-8000-000000000123';
const receivedAt = new Date('2026-07-21T08:00:00.000Z');

function rawBody(payload: object): Buffer {
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

function signature(body: Buffer): string {
  return `sha256=${createHmac('sha256', syntheticSecret).update(body).digest('hex')}`;
}

function repositoryPayload(overrides: object = {}): object {
  return {
    id: 123456789,
    full_name: `${syntheticOrg}/synthetic-repository`,
    private: true,
    archived: false,
    pushed_at: 1_768_992_000,
    ...overrides,
  };
}

function pushPayload(overrides: object = {}): object {
  return {
    after: '1111111111111111111111111111111111111111',
    size: 2,
    organization: { login: syntheticOrg },
    repository: repositoryPayload(),
    head_commit: {
      timestamp: '2026-01-21T08:00:00.000Z',
      message: 'must not be persisted',
      author: { email: 'fixture@example.invalid' },
    },
    commits: [{ message: 'must not be persisted' }],
    ...overrides,
  };
}

function buildService(
  options: {
    readonly configured?: boolean;
    readonly persistResult?: 'stored' | 'duplicate';
  } = {},
): {
  readonly service: GithubWebhookService;
  readonly persist: jest.Mock;
} {
  const persist = jest
    .fn()
    .mockResolvedValue(options.persistResult ?? 'stored');
  const config = {
    targetOrg: options.configured === false ? null : syntheticOrg,
    webhookSecret: options.configured === false ? null : syntheticSecret,
  } satisfies Pick<GithubWebhookConfig, 'targetOrg' | 'webhookSecret'>;
  const repository = { persist } satisfies Pick<
    GithubWebhookRepository,
    'persist'
  >;

  return {
    service: new GithubWebhookService(config, repository),
    persist,
  };
}

function request(body: Buffer, eventType = 'push') {
  return {
    rawBody: body,
    signature: signature(body),
    deliveryId: syntheticDeliveryId,
    eventType,
    receivedAt,
  };
}

describe('GithubWebhookService.handle', () => {
  it('valid push는 allowlist metadata와 commit delta만 저장한다', async () => {
    const body = rawBody(pushPayload());
    const { service, persist } = buildService();

    const result = await service.handle(request(body));

    expect(result).toEqual({ outcome: 'accepted' });
    expect(persist).toHaveBeenCalledWith({
      repository: {
        githubRepositoryId: 123456789n,
        fullName: `${syntheticOrg}/synthetic-repository`,
        visibility: 'PRIVATE',
        archived: false,
      },
      activity: {
        deliveryId: syntheticDeliveryId,
        eventType: 'push',
        occurredAt: new Date('2026-01-21T08:00:00.000Z'),
        dedupeKey: '123456789:push:1111111111111111111111111111111111111111',
        commitDelta: 2,
        pullRequestDelta: 0,
        starDelta: 0,
      },
      observedAt: receivedAt,
    });
  });

  it('valid release는 raw body 없이 release 식별자로 멱등 저장한다', async () => {
    const body = rawBody({
      action: 'published',
      organization: { login: syntheticOrg },
      repository: repositoryPayload({ private: false }),
      release: {
        id: 987654321,
        published_at: '2026-01-21T09:00:00.000Z',
        body: 'must not be persisted',
        tag_name: 'v1.0.0',
      },
    });
    const { service, persist } = buildService();

    const result = await service.handle(request(body, 'release'));

    expect(result).toEqual({ outcome: 'accepted' });
    expect(persist).toHaveBeenCalledWith({
      repository: {
        githubRepositoryId: 123456789n,
        fullName: `${syntheticOrg}/synthetic-repository`,
        visibility: 'PUBLIC',
        archived: false,
      },
      activity: {
        deliveryId: syntheticDeliveryId,
        eventType: 'release',
        occurredAt: new Date('2026-01-21T09:00:00.000Z'),
        dedupeKey: '123456789:release:987654321:published',
        commitDelta: 0,
        pullRequestDelta: 0,
        starDelta: 0,
      },
      observedAt: receivedAt,
    });
  });

  it('invalid signature는 JSON 파싱이나 저장 전에 거부한다', async () => {
    const { service, persist } = buildService();
    const body = Buffer.from('not-json', 'utf8');

    const promise = service.handle({
      ...request(body),
      signature:
        'sha256=0000000000000000000000000000000000000000000000000000000000000000',
    });

    await expect(promise).rejects.toBeInstanceOf(UnauthorizedException);
    expect(persist).not.toHaveBeenCalled();
  });

  it('같은 delivery 또는 dedupe 저장 충돌은 성공 duplicate로 수렴한다', async () => {
    const body = rawBody(pushPayload());
    const { service } = buildService({ persistResult: 'duplicate' });

    await expect(service.handle(request(body))).resolves.toEqual({
      outcome: 'duplicate',
    });
  });

  it('대상 Org 밖 repository는 데이터 쓰기 없이 무시한다', async () => {
    const body = rawBody(
      pushPayload({ organization: { login: 'outside-synthetic-org' } }),
    );
    const { service, persist } = buildService();

    await expect(service.handle(request(body))).resolves.toEqual({
      outcome: 'ignored',
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it('구독하지 않은 event는 본문을 파싱하거나 쓰지 않고 무시한다', async () => {
    const body = Buffer.from('not-json', 'utf8');
    const { service, persist } = buildService();

    await expect(service.handle(request(body, 'issues'))).resolves.toEqual({
      outcome: 'ignored',
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it('valid signature 뒤 payload가 계약과 다르면 400으로 거부한다', async () => {
    const body = rawBody({ organization: { login: syntheticOrg } });
    const { service, persist } = buildService();

    await expect(service.handle(request(body))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(persist).not.toHaveBeenCalled();
  });

  it('Collection App webhook 설정이 없으면 fail-closed 503이다', async () => {
    const body = rawBody(pushPayload());
    const { service, persist } = buildService({ configured: false });

    await expect(service.handle(request(body))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(persist).not.toHaveBeenCalled();
  });
});
