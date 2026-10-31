import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../platform/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { ConsentsService } from './consents.service';
import { ConsentCurrentResponseDto } from './dto/consent-current-response.dto';
import { ConsentResponseDto } from './dto/consent-response.dto';
import { CreateConsentRequestDto } from './dto/create-consent-request.dto';
import { Protected } from '../auth/authentication.guard';

@Controller('consents')
export class ConsentsController {
  constructor(private readonly consentsService: ConsentsService) {}

  @Get('current')
  @Protected()
  async getCurrent(
    @Req() request: AuthenticatedRequest,
  ): Promise<ConsentCurrentResponseDto> {
    const status = await this.consentsService.getCurrent(
      request.sessionGithubId,
    );
    return ConsentCurrentResponseDto.from(status);
  }

  @Post()
  @Protected()
  @UseGuards(OriginGuard)
  @HttpCode(200)
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateConsentRequestDto,
  ): Promise<ConsentResponseDto> {
    const grant = await this.consentsService.accept(request.sessionGithubId, {
      policyVersion: body.policyVersion,
      acceptedItems: body.acceptedItems,
    });
    return ConsentResponseDto.from(grant);
  }
}
