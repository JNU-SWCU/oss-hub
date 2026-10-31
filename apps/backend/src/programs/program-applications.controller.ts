import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../platform/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { ApplicationsService } from './applications.service';
import { ApplicationListRequestDto } from './dto/application-list-request.dto';
import { ApplicationListPageResponseDto } from './dto/application-list-page-response.dto';
import { CreateApplicationRequestDto } from './dto/create-application-request.dto';
import { CreateApplicationResponseDto } from './dto/create-application-response.dto';
import { TeamManagementListPageResponseDto } from './dto/team-management-list-page-response.dto';
import { Protected } from '../auth/authentication.guard';
import { Roles, STAFF_AUDIENCE } from '../platform/roles.guard';
import { DomainException } from '../platform/error-code.error';
import {
  APPLICATIONS_ERROR_CODES,
  ApplicationsErrorCode,
} from './applications-error-code.error';

type ApplicationSessionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

const staffListOnly = () =>
  new DomainException(
    APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.STAFF_LIST_ONLY],
  );

@Controller('programs/:programId/applications')
export class ProgramApplicationsController {
  constructor(
    @Inject(ApplicationsService)
    private readonly service: Pick<
      ApplicationsService,
      'create' | 'listForProgram' | 'listTeamManagementForProgram'
    >,
  ) {}

  @Get()
  @Protected()
  @Roles(STAFF_AUDIENCE, staffListOnly)
  async list(
    @Param('programId') programId: string,
    @Query() query: ApplicationListRequestDto,
  ): Promise<
    ApplicationListPageResponseDto | TeamManagementListPageResponseDto
  > {
    const listQuery = query.toQuery();
    if (listQuery.view === 'team-management') {
      return TeamManagementListPageResponseDto.from(
        await this.service.listTeamManagementForProgram(programId, listQuery),
      );
    }
    return ApplicationListPageResponseDto.from(
      await this.service.listForProgram(programId, listQuery),
    );
  }

  @Post()
  @HttpCode(201)
  @Protected()
  @UseGuards(OriginGuard)
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
