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
import { OriginGuard } from '../../auth/controller/origin.guard';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { SessionGuard } from '../../auth/controller/session.guard';
import { ApplicationsService } from '../service/applications.service';
import { ApplicationListQueryRequestDto } from '../dto/application-list-query.dto';
import { ApplicationListPageResponseDto } from '../dto/application-list-response.dto';
import { CreateApplicationRequestDto } from '../dto/create-application-request.dto';
import { CreateApplicationResponseDto } from '../dto/create-application-response.dto';
import { TeamManagementListPageResponseDto } from '../dto/team-management-list-response.dto';

type ApplicationSessionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

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
  @UseGuards(SessionGuard)
  async list(
    @Req() request: ApplicationSessionRequest,
    @Param('programId') programId: string,
    @Query() query: ApplicationListQueryRequestDto,
  ): Promise<
    ApplicationListPageResponseDto | TeamManagementListPageResponseDto
  > {
    const listQuery = query.toQuery();
    if (listQuery.view === 'team-management') {
      return TeamManagementListPageResponseDto.from(
        await this.service.listTeamManagementForProgram(
          request.sessionGithubId,
          programId,
          listQuery,
        ),
      );
    }
    return ApplicationListPageResponseDto.from(
      await this.service.listForProgram(
        request.sessionGithubId,
        programId,
        listQuery,
      ),
    );
  }

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
