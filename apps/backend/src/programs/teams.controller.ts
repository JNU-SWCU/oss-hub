import { Body, Controller, Get, Inject, Param, Patch, Req, UseGuards } from "@nestjs/common";
import { OriginGuard } from "../platform/origin.guard";
import type { AuthenticatedRequest } from "../auth/http-auth.types";
import { TeamApplicationService } from "./team-application.service";
import { ApplicationDecisionResponseDto } from "./dto/application-decision-response.dto";
import { ApplicationDetailResponseDto } from "./dto/application-list-page-response.dto";
import { PatchApplicationDecisionRequestDto } from "./dto/patch-application-decision-request.dto";
import { Protected } from "../auth/auth-route.decorator";
import { STAFF_AUDIENCE } from "../platform/roles.guard";
import { Roles } from "../platform/roles.decorator";
import { DomainException } from "../platform/error-code.error";
import { APPLICATIONS_ERROR_CODES, ApplicationsErrorCode } from "./applications-error-code.error";
import { HttpCode, Post, Query } from "@nestjs/common";
import { ApplicationListRequestDto } from "./dto/application-list-request.dto";
import { ApplicationListPageResponseDto } from "./dto/application-list-page-response.dto";
import { CreateApplicationRequestDto } from "./dto/create-application-request.dto";
import { CreateApplicationResponseDto } from "./dto/create-application-response.dto";
import { TeamManagementListPageResponseDto } from "./dto/team-management-list-page-response.dto";
import { Delete, Header } from "@nestjs/common";
import { MyStudentApplicationResponseDto } from "./dto/my-student-application-response.dto";
import { UpdateStudentApplicationRequestDto } from "./dto/update-student-application-request.dto";
import { StudentApplicationCancellationResponseDto, StudentApplicationResponseDto } from "./dto/student-application-response.dto";
import { StudentApplicationManagementService } from "./team-application.service";
import { ApplicationTemplateListResponseDto } from "./dto/application-template-response.dto";
import { Public } from "../auth/auth-route.decorator";
import { ProgramTemplatesService } from "./team-application.service";
import { DeleteTeamRequestDto } from "./dto/delete-team-request.dto";
import { MyProgramTeamResponseDto } from "./dto/my-program-team-response.dto";
import { RenameTeamRequestDto } from "./dto/rename-team-request.dto";
import { TransferTeamLeaderRequestDto } from "./dto/transfer-team-leader-request.dto";
import { StaffTeamDetailResponseDto, RepositoryUrlHistoryResponseDto } from "./dto/staff-team-detail-response.dto";
import { RepositoryUrlHistoryRequestDto } from "./dto/repository-url-history-request.dto";
import { TeamActivityResponseDto } from "./dto/team-activity-response.dto";
import { DeleteTeamResponseDto, RenameTeamResponseDto, StaffProgramTeamResponseDto } from "./dto/program-team-response.dto";
import { TeamMembershipService } from "./team-membership.service";
import { TEAMS_ERROR_CODES, TeamsErrorCode } from "./teams-error-code.error";
import { UpdateStudentRepositoryUrlRequestDto } from "./dto/update-student-repository-url-request.dto";
import { StudentRepositoryUrlResponseDto } from "./dto/student-repository-url-response.dto";
import { StudentRepositoryUrlService } from "./team-application.service";

type ApplicationActorRequest = Pick<AuthenticatedRequest, 'principal'>;

const staffListOnly = () =>
  new DomainException(
    APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.STAFF_LIST_ONLY],
  );

const staffOnly = () =>
  new DomainException(
    APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.STAFF_ONLY],
  );

@Controller('teams')
export class ApplicationsController {
  constructor(
    @Inject(TeamApplicationService)
    private readonly service: Pick<
      TeamApplicationService,
      'decide' | 'getForStaff'
    >,
  ) {}

  @Get(':id')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffListOnly)
  async detail(
    @Param('id') teamId: string,
  ): Promise<ApplicationDetailResponseDto> {
    return ApplicationDetailResponseDto.from(
      await this.service.getForStaff(teamId),
    );
  }

  @Patch(':id')
  @Protected()
  @Roles(STAFF_AUDIENCE, staffOnly)
  @UseGuards(OriginGuard)
  async decide(
    @Req() request: ApplicationActorRequest,
    @Param('id') teamId: string,
    @Body() body: PatchApplicationDecisionRequestDto,
  ): Promise<ApplicationDecisionResponseDto> {
    const result = await this.service.decide(
      request.principal,
      teamId,
      body,
    );
    return ApplicationDecisionResponseDto.from(result);
  }
}

type ApplicationSessionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('programs/:programId/teams')
export class ProgramApplicationsController {
  constructor(
    @Inject(TeamApplicationService)
    private readonly service: Pick<
      TeamApplicationService,
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

type StudentApplicationRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('programs/:programId/teams/me')
@Protected()
export class StudentApplicationsController {
  constructor(
    @Inject(StudentApplicationManagementService)
    private readonly service: Pick<
      StudentApplicationManagementService,
      'getMine' | 'updateMine' | 'cancelMine'
    >,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async getMine(
    @Req() request: StudentApplicationRequest,
    @Param('programId') programId: string,
  ): Promise<MyStudentApplicationResponseDto> {
    const application = await this.service.getMine(
      request.sessionGithubId,
      programId,
    );
    return MyStudentApplicationResponseDto.from(application);
  }

  @Patch()
  @UseGuards(OriginGuard)
  async updateMine(
    @Req() request: StudentApplicationRequest,
    @Param('programId') programId: string,
    @Body() body: UpdateStudentApplicationRequestDto,
  ): Promise<StudentApplicationResponseDto> {
    return StudentApplicationResponseDto.from(
      await this.service.updateMine(request.sessionGithubId, programId, body),
    );
  }

  @Delete()
  @UseGuards(OriginGuard)
  async cancelMine(
    @Req() request: StudentApplicationRequest,
    @Param('programId') programId: string,
  ): Promise<StudentApplicationCancellationResponseDto> {
    return StudentApplicationCancellationResponseDto.from(
      await this.service.cancelMine(request.sessionGithubId, programId),
    );
  }
}

@Controller('programs/team-templates')
@Public()
export class ApplicationTemplatesController {
  constructor(
    private readonly programTemplatesService: ProgramTemplatesService,
  ) {}

  @Get()
  list(): ApplicationTemplateListResponseDto {
    return ApplicationTemplateListResponseDto.from(
      this.programTemplatesService.listProgramTemplates(),
    );
  }
}

type TeamSessionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

const teamStaffOnly = () =>
  new DomainException(TEAMS_ERROR_CODES[TeamsErrorCode.STAFF_ONLY]);

@Controller('programs/:programId/teams')
export class TeamsController {
  constructor(
    @Inject(TeamMembershipService)
    private readonly service: Pick<
      TeamMembershipService,
      | 'getMe'
      | 'leave'
      | 'removeMember'
      | 'listForStaff'
      | 'getForStaff'
      | 'getActivity'
      | 'getRepositoryUrlHistoryFromRequest'
      | 'rename'
      | 'deleteForStaffFromRequest'
      | 'removeMemberForStaff'
      | 'transferLeaderForStaff'
      | 'transferLeader'
    >,
  ) {}

  @Get('me/membership')
  @Protected()
  async me(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
  ): Promise<MyProgramTeamResponseDto> {
    const team = await this.service.getMe(request.sessionGithubId, programId);
    return MyProgramTeamResponseDto.from(team);
  }

  @Delete('me/membership')
  @HttpCode(204)
  @Protected()
  @UseGuards(OriginGuard)
  async leave(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
  ): Promise<void> {
    await this.service.leave(request.sessionGithubId, programId);
  }

  @Delete('me/members/:userId')
  @HttpCode(204)
  @Protected()
  @UseGuards(OriginGuard)
  async removeMember(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.service.removeMember(request.sessionGithubId, programId, userId);
  }

  @Get(':teamId')
  @Protected()
  @Roles(STAFF_AUDIENCE, teamStaffOnly)
  async detail(
    @Param('programId') programId: string,
    @Param('teamId') teamId: string,
  ): Promise<StaffTeamDetailResponseDto> {
    return StaffTeamDetailResponseDto.from(
      await this.service.getForStaff(programId, teamId),
    );
  }

  @Get(':teamId/activity')
  @Protected()
  async activity(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
    @Param('teamId') teamId: string,
  ): Promise<TeamActivityResponseDto> {
    return TeamActivityResponseDto.from(
      await this.service.getActivity(
        request.sessionGithubId,
        programId,
        teamId,
      ),
    );
  }

  @Get(':teamId/repository-url-history')
  @Protected()
  async repositoryUrlHistory(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
    @Param('teamId') teamId: string,
    @Query() query: RepositoryUrlHistoryRequestDto,
  ): Promise<RepositoryUrlHistoryResponseDto> {
    return RepositoryUrlHistoryResponseDto.from(
      await this.service.getRepositoryUrlHistoryFromRequest(
        request.sessionGithubId,
        programId,
        teamId,
        query,
      ),
    );
  }

  @Patch(':teamId')
  @Protected()
  @UseGuards(OriginGuard)
  async rename(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
    @Param('teamId') teamId: string,
    @Body() body: RenameTeamRequestDto,
  ): Promise<RenameTeamResponseDto> {
    return RenameTeamResponseDto.from(
      await this.service.rename(
        request.sessionGithubId,
        programId,
        teamId,
        body.name,
      ),
    );
  }

  @Delete(':teamId/members/:userId')
  @HttpCode(204)
  @Protected()
  @UseGuards(OriginGuard)
  async removeMemberForStaff(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.service.removeMemberForStaff(
      request.sessionGithubId,
      programId,
      teamId,
      userId,
    );
  }

  @Patch('me/leader')
  @HttpCode(204)
  @Protected()
  @UseGuards(OriginGuard)
  async transferLeader(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
    @Body() body: TransferTeamLeaderRequestDto,
  ): Promise<void> {
    await this.service.transferLeader(request.sessionGithubId, programId, body.userId);
  }

  @Patch(':teamId/leader')
  @HttpCode(204)
  @Protected()
  @UseGuards(OriginGuard)
  async transferLeaderForStaff(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
    @Param('teamId') teamId: string,
    @Body() body: TransferTeamLeaderRequestDto,
  ): Promise<void> {
    await this.service.transferLeaderForStaff(
      request.sessionGithubId,
      programId,
      teamId,
      body.userId,
    );
  }

  @Delete(':teamId')
  @Protected()
  @UseGuards(OriginGuard)
  async remove(
    @Req() request: TeamSessionRequest,
    @Param('programId') programId: string,
    @Param('teamId') teamId: string,
    @Body() body: DeleteTeamRequestDto,
  ): Promise<DeleteTeamResponseDto> {
    return DeleteTeamResponseDto.from(
      await this.service.deleteForStaffFromRequest(
        request.sessionGithubId,
        programId,
        teamId,
        body,
      ),
    );
  }
}

@Controller('programs/:programId')
@Protected()
export class StudentRepositoryUrlController {
  constructor(private readonly service: StudentRepositoryUrlService) {}

  @Patch('teams/me/repository-url')
  @UseGuards(OriginGuard)
  async updateMine(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
    @Param('programId') programId: string,
    @Body() body: UpdateStudentRepositoryUrlRequestDto,
  ): Promise<StudentRepositoryUrlResponseDto> {
    return StudentRepositoryUrlResponseDto.from(
      await this.service.updateMine(request.sessionGithubId, programId, {
        repositoryUrl: body.repositoryUrl,
      }),
    );
  }

  @Patch('teams/:teamId/repository-url')
  @UseGuards(OriginGuard)
  async updateForTeam(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
    @Param('programId') programId: string,
    @Param('teamId') teamId: string,
    @Body() body: UpdateStudentRepositoryUrlRequestDto,
  ): Promise<StudentRepositoryUrlResponseDto> {
    return StudentRepositoryUrlResponseDto.from(
      await this.service.updateForTeam(
        request.sessionGithubId,
        programId,
        teamId,
        { repositoryUrl: body.repositoryUrl },
      ),
    );
  }
}
