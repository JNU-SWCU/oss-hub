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

@Controller('programs/:programId/applications/me/repository-url')
@UseGuards(SessionGuard)
export class StudentRepositoryUrlController {
  constructor(private readonly service: StudentRepositoryUrlService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  getMine(
    @Req() request: Pick<AuthenticatedRequest, 'sessionGithubId'>,
    @Param('programId') programId: string,
  ): Promise<StudentRepositoryUrlView> {
    return this.service.getMine(request.sessionGithubId, programId);
  }

  @Patch()
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
}
