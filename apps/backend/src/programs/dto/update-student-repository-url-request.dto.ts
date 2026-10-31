import { Transform } from 'class-transformer';
import { IsString, MaxLength, Validate } from 'class-validator';
import { GithubRepositoryUrlConstraintService } from '../github-repository-url-constraint.service';

export class UpdateStudentRepositoryUrlRequestDto {
  @Transform(({ value }: { readonly value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(250)
  @Validate(GithubRepositoryUrlConstraintService)
  declare readonly repositoryUrl: string;
}
