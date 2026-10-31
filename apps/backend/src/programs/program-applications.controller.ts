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
import { Protected } from '../auth/auth-route.decorator';
import { STAFF_AUDIENCE } from '../platform/roles.guard';
import { Roles } from '../platform/roles.decorator';
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
      'createFromRequest' | 'listForProgramView'
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
    const listed = await this.service.listForProgramView(programId, query);
    return listed.view === 'team-management'
      ? TeamManagementListPageResponseDto.from(listed.page)
      : ApplicationListPageResponseDto.from(listed.page);
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
    const application = await this.service.createFromRequest(
      request.sessionGithubId,
      programId,
      body,
    );
    return CreateApplicationResponseDto.from(application);
  }
}
