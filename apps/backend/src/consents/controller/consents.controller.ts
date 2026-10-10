import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../../auth/controller/origin.guard';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { SessionGuard } from '../../auth/controller/session.guard';
import { ConsentsService } from '../service/consents.service';
import { ConsentCurrentResponseDto } from '../dto/consent-current-response.dto';
import { ConsentResponseDto } from '../dto/consent-response.dto';
import { CreateConsentRequestDto } from '../dto/create-consent-request.dto';

@Controller('consents')
export class ConsentsController {
  constructor(private readonly consentsService: ConsentsService) {}

  @Get('current')
  @UseGuards(SessionGuard)
  async getCurrent(
    @Req() request: AuthenticatedRequest,
  ): Promise<ConsentCurrentResponseDto> {
    const status = await this.consentsService.getCurrent(
      request.sessionGithubId,
    );
    return ConsentCurrentResponseDto.from(status);
  }

  @Post()
  @UseGuards(SessionGuard, OriginGuard)
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
