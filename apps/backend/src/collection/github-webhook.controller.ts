import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { GithubWebhookService } from './github-webhook.service';
import type { GithubWebhookOutcome } from './github-webhook.types';

@Controller('webhooks')
export class GithubWebhookController {
  constructor(private readonly service: GithubWebhookService) {}

  @Post('github')
  @HttpCode(200)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-delivery') deliveryId: string | undefined,
    @Headers('x-github-event') eventType: string | undefined,
  ): Promise<GithubWebhookOutcome> {
    const rawBody = request.rawBody;
    if (rawBody === undefined) {
      throw new BadRequestException('raw webhook body is unavailable');
    }
    return this.service.handle({
      rawBody,
      signature,
      deliveryId,
      eventType,
      receivedAt: new Date(),
    });
  }
}
