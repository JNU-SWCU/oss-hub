import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { GithubWebhookConfig } from './github-webhook.config';
import { GithubWebhookController } from './github-webhook.controller';
import { GithubWebhookRepository } from './github-webhook.repository';
import { GithubWebhookService } from './github-webhook.service';

const syntheticSecret = 'synthetic-http-webhook-secret';
const syntheticDeliveryId = '00000000-0000-4000-8000-000000000123';
const persist = jest.fn().mockResolvedValue('stored');
let application: INestApplication | undefined;
let baseUrl = '';

function signedHeaders(body: string): Readonly<Record<string, string>> {
  const signature = createHmac('sha256', syntheticSecret)
    .update(body)
    .digest('hex');
  return {
    connection: 'close',
    'content-type': 'application/json',
    'x-github-delivery': syntheticDeliveryId,
    'x-github-event': 'push',
    'x-hub-signature-256': `sha256=${signature}`,
  };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [GithubWebhookController],
    providers: [
      GithubWebhookService,
      {
        provide: GithubWebhookConfig,
        useValue: {
          targetOrg: 'JNU-SWCU',
          webhookSecret: syntheticSecret,
        },
      },
      { provide: GithubWebhookRepository, useValue: { persist } },
    ],
  }).compile();

  application = moduleRef.createNestApplication({ rawBody: true });
  application.setGlobalPrefix('api/v1');
  application.useGlobalFilters(new ProblemDetailFilter());
  await application.listen(0, '127.0.0.1');
  baseUrl = await application.getUrl();
});

beforeEach(() => {
  jest.clearAllMocks();
});

afterAll(async () => {
  await application?.close();
});

it('POST /api/v1/webhooks/github는 raw body 서명을 검증해 event를 저장한다', async () => {
  const body = JSON.stringify({
    after: '1111111111111111111111111111111111111111',
    size: 1,
    organization: { login: 'JNU-SWCU' },
    repository: {
      id: 123456789,
      full_name: 'JNU-SWCU/synthetic-http-repository',
      private: true,
      archived: false,
      pushed_at: 1_768_992_000,
    },
    head_commit: null,
  });

  const response = await fetch(`${baseUrl}/api/v1/webhooks/github`, {
    method: 'POST',
    headers: signedHeaders(body),
    body,
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ outcome: 'accepted' });
  expect(persist).toHaveBeenCalledTimes(1);
});

it('invalid signature는 401이고 persistence를 호출하지 않는다', async () => {
  const body = JSON.stringify({ fixture: true });
  const headers = {
    ...signedHeaders(body),
    'x-hub-signature-256':
      'sha256=0000000000000000000000000000000000000000000000000000000000000000',
  };

  const response = await fetch(`${baseUrl}/api/v1/webhooks/github`, {
    method: 'POST',
    headers,
    body,
  });

  expect(response.status).toBe(401);
  expect(persist).not.toHaveBeenCalled();
});
