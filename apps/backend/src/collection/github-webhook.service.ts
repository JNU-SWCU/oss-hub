import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
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
  GithubWebhookObservationInput,
  GithubWebhookOutcome,
  GithubWebhookRequest,
} from './github-webhook.types';
import {
  GITHUB_ACTIVITY_EVENT_TYPES,
  GITHUB_WEBHOOK_OBSERVATION_ERROR_CODES,
  GITHUB_WEBHOOK_OBSERVATION_OUTCOMES,
} from './github-webhook.types';

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
  private readonly logger = new Logger(GithubWebhookService.name);

  constructor(
    @Inject(GithubWebhookConfig)
    private readonly config: Pick<
      GithubWebhookConfig,
      'targetOrg' | 'webhookSecret'
    >,
    @Inject(GithubWebhookRepository)
    private readonly repository: Pick<
      GithubWebhookRepository,
      'persist' | 'observe'
    >,
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

    const deliveryId = request.deliveryId;
    if (deliveryId === undefined || !DELIVERY_ID_PATTERN.test(deliveryId)) {
      throw new BadRequestException('invalid GitHub delivery ID');
    }
    const observedEventType = request.eventType ?? 'unknown';
    const eventType = activityEventType(request.eventType);
    if (eventType === null) {
      await this.observeBestEffort({
        deliveryId,
        eventType: observedEventType,
        receivedAt: request.receivedAt,
        outcome: GITHUB_WEBHOOK_OBSERVATION_OUTCOMES.IGNORED,
      });
      return { outcome: 'ignored' };
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
        await this.observeBestEffort({
          deliveryId,
          eventType,
          receivedAt: request.receivedAt,
          outcome: GITHUB_WEBHOOK_OBSERVATION_OUTCOMES.IGNORED,
        });
        return { outcome: 'ignored' };
      }
      let persisted: Awaited<ReturnType<GithubWebhookRepository['persist']>>;
      try {
        persisted = await this.repository.persist(input);
      } catch (error) {
        await this.observeBestEffort({
          deliveryId,
          eventType,
          receivedAt: request.receivedAt,
          outcome: GITHUB_WEBHOOK_OBSERVATION_OUTCOMES.FAILED,
          errorCode: GITHUB_WEBHOOK_OBSERVATION_ERROR_CODES.PROCESSING_FAILED,
        });
        throw error;
      }
      return persisted === 'stored'
        ? { outcome: 'accepted' }
        : { outcome: 'duplicate' };
    } catch (error) {
      if (error instanceof InvalidGithubWebhookPayloadError) {
        await this.observeBestEffort({
          deliveryId,
          eventType,
          receivedAt: request.receivedAt,
          outcome: GITHUB_WEBHOOK_OBSERVATION_OUTCOMES.FAILED,
          errorCode: GITHUB_WEBHOOK_OBSERVATION_ERROR_CODES.INVALID_PAYLOAD,
        });
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private async observeBestEffort(
    input: GithubWebhookObservationInput,
  ): Promise<void> {
    try {
      await this.repository.observe(input);
    } catch (error: unknown) {
      // no-excuse-ok: catch — 부가 관측은 webhook의 1차 결과를 바꾸지 않는다.
      this.logger.warn({
        event: 'collection.webhook.observation_failed',
        outcome: input.outcome,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }
}
