import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../../auth/controller/origin.guard';
import { SessionGuard } from '../../auth/controller/session.guard';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { ApplicationPreparationsService } from '../service/application-preparations.service';
import {
  CreateApplicationPreparationRequestDto,
  InviteApplicationPreparationRequestDto,
  SearchApplicationPreparationRequestDto,
} from '../dto/application-preparation-request.dto';
import {
  ApplicationPreparationInvitationResponseDto,
  ApplicationPreparationResponseDto,
} from '../dto/application-preparation-response.dto';

@Controller('application-preparations')
@UseGuards(SessionGuard)
export class ApplicationPreparationsController {
  constructor(private readonly service: ApplicationPreparationsService) {}

  @Get('programs/:programId/me')
  async get(
    @Req() request: AuthenticatedRequest,
    @Param('programId') programId: string,
  ) {
    const preparation = await this.service.get(
      request.sessionGithubId,
      programId,
    );
    return preparation
      ? ApplicationPreparationResponseDto.from(preparation)
      : null;
  }
  @Post('programs/:programId')
  @UseGuards(OriginGuard)
  async create(
    @Req() request: AuthenticatedRequest,
    @Param('programId') programId: string,
    @Body() body: CreateApplicationPreparationRequestDto,
  ) {
    return ApplicationPreparationResponseDto.from(
      await this.service.create(request.sessionGithubId, programId, body.name),
    );
  }
  @Delete('programs/:programId/me')
  @HttpCode(204)
  @UseGuards(OriginGuard)
  leave(
    @Req() request: AuthenticatedRequest,
    @Param('programId') programId: string,
  ) {
    return this.service.leave(request.sessionGithubId, programId);
  }
  @Delete('programs/:programId/members/:userId')
  @HttpCode(204)
  @UseGuards(OriginGuard)
  remove(
    @Req() request: AuthenticatedRequest,
    @Param('programId') programId: string,
    @Param('userId') userId: string,
  ) {
    return this.service.remove(request.sessionGithubId, programId, userId);
  }
  @Get(':preparationId/sent')
  async sent(
    @Req() request: AuthenticatedRequest,
    @Param('preparationId') preparationId: string,
  ) {
    return (
      await this.service.listSent(request.sessionGithubId, preparationId)
    ).map((invitation) =>
      ApplicationPreparationInvitationResponseDto.from(invitation),
    );
  }
  @Get(':preparationId/search')
  search(
    @Req() request: AuthenticatedRequest,
    @Param('preparationId') preparationId: string,
    @Query() query: SearchApplicationPreparationRequestDto,
  ) {
    return this.service.search(
      request.sessionGithubId,
      preparationId,
      query.query,
    );
  }
  @Post(':preparationId/invitations')
  @UseGuards(OriginGuard)
  async invite(
    @Req() request: AuthenticatedRequest,
    @Param('preparationId') preparationId: string,
    @Body() body: InviteApplicationPreparationRequestDto,
  ) {
    return ApplicationPreparationInvitationResponseDto.from(
      await this.service.invite(
        request.sessionGithubId,
        preparationId,
        body.inviteeUserId,
      ),
    );
  }
  @Post('invitations/:invitationId/accept')
  @HttpCode(200)
  @UseGuards(OriginGuard)
  accept(
    @Req() request: AuthenticatedRequest,
    @Param('invitationId') invitationId: string,
  ) {
    return this.service.respond(
      request.sessionGithubId,
      invitationId,
      'accept',
    );
  }
  @Post('invitations/:invitationId/decline')
  @HttpCode(204)
  @UseGuards(OriginGuard)
  async decline(
    @Req() request: AuthenticatedRequest,
    @Param('invitationId') invitationId: string,
  ) {
    await this.service.respond(
      request.sessionGithubId,
      invitationId,
      'decline',
    );
  }
  @Post('invitations/:invitationId/cancel')
  @HttpCode(204)
  @UseGuards(OriginGuard)
  async cancel(
    @Req() request: AuthenticatedRequest,
    @Param('invitationId') invitationId: string,
  ) {
    await this.service.respond(request.sessionGithubId, invitationId, 'cancel');
  }
}
