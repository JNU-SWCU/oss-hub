import { Body, Controller, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { OriginGuard } from '../platform/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { UpdateStudentRepositoryUrlRequestDto } from './dto/update-student-repository-url-request.dto';
import { StudentRepositoryUrlResponseDto } from './dto/student-repository-url-response.dto';
import { StudentRepositoryUrlService } from './student-repository-url.service';
import { Protected } from '../auth/auth-route.decorator';

@Controller('programs/:programId')
@Protected()
export class StudentRepositoryUrlController {
  constructor(private readonly service: StudentRepositoryUrlService) {}

  @Patch('applications/me/repository-url')
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
