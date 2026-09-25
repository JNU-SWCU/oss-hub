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
import { Transform } from 'class-transformer';
import {
  IsString,
  MaxLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { parseGithubRepositoryUrl } from '../common/github-repository-url';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard, type AuthenticatedRequest } from '../auth/session.guard';
import {
  StudentRepositoryUrlService,
  type StudentRepositoryUrlView,
} from './student-repository-url.service';

@ValidatorConstraint({ name: 'githubRepositoryUrl', async: false })
class GithubRepositoryUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      typeof value === 'string' && parseGithubRepositoryUrl(value) !== null
    );
  }
}

export class UpdateStudentRepositoryUrlRequestDto {
  @Transform(({ value }: { readonly value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(250)
  @Validate(GithubRepositoryUrlConstraint)
  declare readonly repositoryUrl: string;
}

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

  /** 팀장과 교직원이 같은 문을 쓴다 — 권한은 service가 판정한다. */
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
