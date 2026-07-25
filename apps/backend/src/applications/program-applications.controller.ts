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
      'create' | 'listForProgram'
    >,
  ) {}

  @Get()
  @UseGuards(SessionGuard, ApplicationsStaffListGuard)
  async list(
    @Param('programId') programId: string,
    @Query() query: ApplicationListQueryRequestDto,
  ): Promise<ApplicationListPageResponseDto> {
    const page = await this.service.listForProgram(programId, query.toQuery());
    return ApplicationListPageResponseDto.from(page);
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
