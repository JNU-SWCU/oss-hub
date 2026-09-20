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
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { ApplicationsStaffListGuard } from './applications-staff.guard';
import { ApplicationsService } from './applications.service';
import { ApplicationListQueryRequestDto } from './dto/application-list-query.dto';
import { ApplicationListPageResponseDto } from './dto/application-list-response.dto';
import { CreateApplicationRequestDto } from './dto/create-application-request.dto';
import { CreateApplicationResponseDto } from './dto/create-application-response.dto';
import { TeamManagementListPageResponseDto } from './dto/team-management-list-response.dto';

type ApplicationSessionRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

/**
 * 프로그램 신청 thin sibling — ProgramsController 와 분리.
 * POST 학생 신청 / GET 교직원 목록 (#104/#106)
 */
@Controller('programs/:programId/applications')
export class ProgramApplicationsController {
  constructor(
    @Inject(ApplicationsService)
    private readonly service: Pick<
      ApplicationsService,
      'create' | 'listForProgram' | 'listTeamManagementForProgram'
    >,
  ) {}

  /**
   * 교직원 목록. `view=team-management`면 팀 관리 화면용 lean projection을 돌려준다.
   * 기본값은 `default`라 이 파라미터를 모르는 기존 클라이언트는 같은 응답을 받는다.
   */
  @Get()
  @UseGuards(SessionGuard, ApplicationsStaffListGuard)
  async list(
    @Param('programId') programId: string,
    @Query() query: ApplicationListQueryRequestDto,
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
