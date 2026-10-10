import { Transform } from 'class-transformer';
import { IsString, MaxLength, Validate } from 'class-validator';
import { GithubRepositoryUrlConstraint } from '../domain/github-repository-url.validator';

export class UpdateStudentRepositoryUrlRequestDto {
  @Transform(({ value }: { readonly value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(250)
  @Validate(GithubRepositoryUrlConstraint)
  declare readonly repositoryUrl: string;
}
