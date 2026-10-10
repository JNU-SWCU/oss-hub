import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../../auth/controller/origin.guard';
import type { AuthenticatedRequest } from '../../auth/controller/http-auth';
import { SessionGuard } from '../../auth/controller/session.guard';
import { UpdateStudentRepositoryUrlRequestDto } from '../dto/update-student-repository-url-request.dto';
import {
  StudentRepositoryUrlService,
  type StudentRepositoryUrlView,
} from '../service/student-repository-url.service';

@Controller('programs/:programId')
@UseGuards(SessionGuard)
export class StudentRepositoryUrlController {
  constructor(private readonly service: StudentRepositoryUrlService) {}

  @Get('applications/me/repository-url')
  @Header('Cache-Control', 'private, no-store')
  getMine(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
    @Param('programId') programId: string,
  ): Promise<StudentRepositoryUrlView> {
    return this.service.getMine(request.sessionGithubId, programId);
  }

  @Patch('applications/me/repository-url')
  @UseGuards(OriginGuard)
  updateMine(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
    @Param('programId') programId: string,
    @Body() body: UpdateStudentRepositoryUrlRequestDto,
  ): Promise<StudentRepositoryUrlView> {
    return this.service.updateMine(request.sessionGithubId, programId, {
      repositoryUrl: body.repositoryUrl,
    });
  }

  @Patch('teams/:teamId/repository-url')
  @UseGuards(OriginGuard)
  updateForTeam(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
    @Param('programId') programId: string,
    @Param('teamId') teamId: string,
    @Body() body: UpdateStudentRepositoryUrlRequestDto,
  ): Promise<StudentRepositoryUrlView> {
    return this.service.updateForTeam(
      request.sessionGithubId,
      programId,
      teamId,
      { repositoryUrl: body.repositoryUrl },
    );
  }
}
