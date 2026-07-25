import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { ApplicationsService } from './applications.service';
import { CreateApplicationRequestDto } from './dto/create-application-request.dto';
import { CreateApplicationResponseDto } from './dto/create-application-response.dto';

type ApplicationSessionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

/**
 * 학생 신청 제출 — ProgramsController 와 분리된 thin sibling.
 * POST /api/v1/programs/:programId/applications
 */
@Controller('programs/:programId/applications')
export class ProgramApplicationsController {
  constructor(
    @Inject(ApplicationsService)
    private readonly service: Pick<ApplicationsService, 'create'>,
  ) {}

  @Post()
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  async create(
    @Req() request: ApplicationSessionRequest,
    @Param('programId') programId: string,
    @Body() body: CreateApplicationRequestDto,
  ): Promise<CreateApplicationResponseDto> {
    const application = await this.service.create(
      request.sessionGithubId,
      programId,
      body.toInput(),
    );
    return CreateApplicationResponseDto.from(application);
  }
}
