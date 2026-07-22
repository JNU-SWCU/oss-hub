import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { GithubWebhookConfig } from './github-webhook.config';
import {
  InvalidGithubWebhookPayloadError,
  parseGithubActivity,
} from './github-webhook.payload';
import { GithubWebhookRepository } from './github-webhook.repository';
import type {
  GithubActivityEventType,
  GithubWebhookOutcome,
  GithubWebhookRequest,
} from './github-webhook.types';
import { GITHUB_ACTIVITY_EVENT_TYPES } from './github-webhook.types';

const DELIVERY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/;

function activityEventType(
  value: string | undefined,
): GithubActivityEventType | null {
  switch (value) {
    case GITHUB_ACTIVITY_EVENT_TYPES.PUSH:
      return GITHUB_ACTIVITY_EVENT_TYPES.PUSH;
    case GITHUB_ACTIVITY_EVENT_TYPES.RELEASE:
      return GITHUB_ACTIVITY_EVENT_TYPES.RELEASE;
    default:
      return null;
  }
}

@Injectable()
export class GithubWebhookService {
  constructor(
    @Inject(GithubWebhookConfig)
    private readonly config: Pick<
      GithubWebhookConfig,
      'targetOrg' | 'webhookSecret'
    >,
    @Inject(GithubWebhookRepository)
    private readonly repository: Pick<GithubWebhookRepository, 'persist'>,
  ) {}

  async handle(request: GithubWebhookRequest): Promise<GithubWebhookOutcome> {
    const targetOrg = this.config.targetOrg;
    const webhookSecret = this.config.webhookSecret;
    if (targetOrg === null || webhookSecret === null) {
      throw new ServiceUnavailableException('GitHub webhook is not configured');
    }
    const signatureMatch = request.signature?.match(SHA256_SIGNATURE_PATTERN);
    const receivedHex = signatureMatch?.[1];
    if (receivedHex === undefined) {
      throw new UnauthorizedException('invalid GitHub webhook signature');
    }
    const expectedSignature = createHmac('sha256', webhookSecret)
      .update(request.rawBody)
      .digest();
    const receivedSignature = Buffer.from(receivedHex, 'hex');
    if (!timingSafeEqual(expectedSignature, receivedSignature)) {
      throw new UnauthorizedException('invalid GitHub webhook signature');
    }

    const eventType = activityEventType(request.eventType);
    if (eventType === null) {
      return { outcome: 'ignored' };
    }
    const deliveryId = request.deliveryId;
    if (deliveryId === undefined || !DELIVERY_ID_PATTERN.test(deliveryId)) {
      throw new BadRequestException('invalid GitHub delivery ID');
    }

    try {
      const input = parseGithubActivity(
        request.rawBody,
        eventType,
        targetOrg,
        deliveryId,
        request.receivedAt,
      );
      if (input === null) {
        return { outcome: 'ignored' };
      }
      const persisted = await this.repository.persist(input);
      return persisted === 'stored'
        ? { outcome: 'accepted' }
        : { outcome: 'duplicate' };
    } catch (error) {
      if (error instanceof InvalidGithubWebhookPayloadError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
